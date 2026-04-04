import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock chrome APIs ──
const mockAlarms = {
  create: vi.fn(async () => {}),
};

vi.stubGlobal('chrome', {
  bookmarks: {
    create: vi.fn(async () => ({ id: 'bk-1' })),
    removeTree: vi.fn(async () => {}),
  },
  alarms: mockAlarms,
});

// ── Mock OPFS ──
vi.mock('../../../storage/opfs.js', () => {
  const store = new Map<string, string>();

  const mockOpfs = {
    readFile: vi.fn(async (path: string) => {
      const content = store.get(path);
      if (content === undefined) throw new Error('File not found');
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
    }),
    appendFile: vi.fn(async (path: string, content: string) => {
      const existing = store.get(path) ?? '';
      store.set(path, existing + content);
    }),
    readLines: vi.fn(async (path: string, lastN?: number) => {
      const content = store.get(path);
      if (content === undefined) throw new Error('File not found');
      const lines = content.split('\n').filter((l: string) => l.length > 0);
      if (lastN !== undefined && lastN > 0) return lines.slice(-lastN);
      return lines;
    }),
    exists: vi.fn(async (path: string) => store.has(path)),
    mkdir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    delete: vi.fn(async (path: string) => { store.delete(path); }),
    _store: store,
  };

  return { opfs: mockOpfs, OPFS: vi.fn(() => mockOpfs) };
});

// ── Mock chrome-storage ──
let agentList: any[] = [];

vi.mock('../../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(async () => agentList),
  setAgentList: vi.fn(async (list: any[]) => { agentList = list; }),
}));

// ── Mock shared storage ──
const taskEvents: any[] = [];

vi.mock('../../../storage/shared.js', () => ({
  appendTaskEvent: vi.fn(async (event: any) => {
    taskEvents.push(event);
  }),
  getTaskState: vi.fn(async () => {
    // Simple replay of task events
    const tasks = new Map<string, any>();
    for (const event of taskEvents) {
      if (event.type === 'created') {
        tasks.set(event.taskId, {
          id: event.taskId,
          subject: event.data.subject ?? '',
          description: event.data.description,
          owner: event.data.owner,
          status: event.data.status ?? 'pending',
          blockedBy: event.data.blockedBy,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        });
      }
    }
    return Array.from(tasks.values());
  }),
}));

import { opfs } from '../../../storage/opfs.js';
import { createCreateAgentTool } from '../create-agent.js';
import { createAssignTaskTool } from '../assign-task.js';
import { createGetAgentStatusTool } from '../get-agent-status.js';
import { createFindAgentTool } from '../find-agent.js';

const MASTER_ID = 'agent-master-001';

// Helper to set up agents
function setupAgents(list: any[]) {
  agentList = list;
}

describe('Master Tools', () => {
  beforeEach(() => {
    agentList = [];
    taskEvents.length = 0;
    (opfs as any)._store.clear();
    vi.clearAllMocks();
  });

  describe('create_agent', () => {
    it('creates a new agent and marks it as created by master', async () => {
      const tool = createCreateAgentTool(MASTER_ID);
      const result = await tool.execute!(
        { name: 'Researcher', role: 'researcher', purpose: 'Research AI trends', temporary: false },
        { messages: [], toolCallId: 'tc-1' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('name', 'Researcher');
      expect(result).toHaveProperty('role', 'researcher');
      expect(result).toHaveProperty('agentId');

      // Check that the agent was registered with createdBy
      const agent = agentList.find((a) => a.id === (result as any).agentId);
      expect(agent).toBeDefined();
      expect(agent.createdBy).toBe(MASTER_ID);
      expect(agent.visibility).toBe('visible');
    });

    it('injects purpose into CLAUDE.md', async () => {
      const tool = createCreateAgentTool(MASTER_ID);
      const result = await tool.execute!(
        { name: 'Writer', role: 'writer', purpose: 'Write blog posts about tech' },
        { messages: [], toolCallId: 'tc-2' } as any,
      );

      const agentId = (result as any).agentId;
      const claudeMd = await opfs.readFile(`agents/${agentId}/CLAUDE.md`);
      expect(claudeMd).toContain('Write blog posts about tech');
      expect(claudeMd).toContain('Purpose (from Master Agent)');
    });
  });

  describe('assign_task', () => {
    it('creates a task and triggers an alarm', async () => {
      // Set up an agent to assign to
      const targetAgentId = 'agent-target-001';
      setupAgents([
        { id: MASTER_ID, name: 'Master', role: 'master', master: true, visibility: 'visible', createdAt: new Date().toISOString() },
        { id: targetAgentId, name: 'Researcher', role: 'researcher', visibility: 'visible', createdAt: new Date().toISOString() },
      ]);
      // Write CLAUDE.md so getAgent works
      (opfs as any)._store.set(`agents/${targetAgentId}/CLAUDE.md`, '# Researcher');

      const tool = createAssignTaskTool(MASTER_ID);
      const result = await tool.execute!(
        { agentId: targetAgentId, description: 'Research AI', prompt: 'Search for recent AI news' },
        { messages: [], toolCallId: 'tc-3' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('assigned', true);
      expect(result).toHaveProperty('taskId');

      // Verify task was created
      expect(taskEvents.length).toBe(1);
      expect(taskEvents[0].data.owner).toBe(targetAgentId);
      expect(taskEvents[0].data.subject).toBe('Research AI');

      // Verify alarm was created
      expect(mockAlarms.create).toHaveBeenCalledWith(
        expect.stringContaining(`agentic:${targetAgentId}`),
        { delayInMinutes: 0.08 },
      );
    });

    it('returns error for non-existent agent', async () => {
      setupAgents([]);
      const tool = createAssignTaskTool(MASTER_ID);
      const result = await tool.execute!(
        { agentId: 'nonexistent', description: 'Test', prompt: 'Test' },
        { messages: [], toolCallId: 'tc-4' } as any,
      );
      expect(result).toHaveProperty('ok', false);
    });
  });

  describe('get_agent_status', () => {
    it('returns agent status with activity and tasks', async () => {
      const targetAgentId = 'agent-target-002';
      setupAgents([
        { id: targetAgentId, name: 'Researcher', role: 'researcher', visibility: 'visible', createdAt: new Date().toISOString() },
      ]);
      (opfs as any)._store.set(`agents/${targetAgentId}/CLAUDE.md`, '# Researcher');

      // Write some activity
      const activityEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        role: 'assistant',
        summary: 'Completed web search',
      });
      (opfs as any)._store.set(
        `agents/${targetAgentId}/activity-log.jsonl`,
        activityEntry + '\n',
      );

      const tool = createGetAgentStatusTool(MASTER_ID);
      const result = await tool.execute!(
        { agentId: targetAgentId },
        { messages: [], toolCallId: 'tc-5' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('name', 'Researcher');
      expect(result).toHaveProperty('role', 'researcher');
      expect((result as any).recentActions.length).toBeGreaterThan(0);
    });

    it('returns error for non-existent agent', async () => {
      setupAgents([]);
      const tool = createGetAgentStatusTool(MASTER_ID);
      const result = await tool.execute!(
        { agentId: 'nonexistent' },
        { messages: [], toolCallId: 'tc-6' } as any,
      );
      expect(result).toHaveProperty('ok', false);
    });
  });

  describe('find_agent', () => {
    it('finds agents by role', async () => {
      setupAgents([
        { id: 'a1', name: 'Master', role: 'master', master: true, visibility: 'visible', createdAt: new Date().toISOString() },
        { id: 'a2', name: 'Researcher', role: 'researcher', visibility: 'visible', createdAt: new Date().toISOString() },
        { id: 'a3', name: 'Coder', role: 'coder', visibility: 'visible', createdAt: new Date().toISOString() },
      ]);

      const tool = createFindAgentTool('a1');
      const result = await tool.execute!(
        { role: 'research' },
        { messages: [], toolCallId: 'tc-7' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect((result as any).agents.length).toBe(1);
      expect((result as any).agents[0].name).toBe('Researcher');
    });

    it('finds agents by name (case-insensitive)', async () => {
      setupAgents([
        { id: 'a1', name: 'Master Bot', role: 'master', master: true, visibility: 'visible', createdAt: new Date().toISOString() },
        { id: 'a2', name: 'Research Bot', role: 'researcher', visibility: 'visible', createdAt: new Date().toISOString() },
      ]);

      const tool = createFindAgentTool('a1');
      const result = await tool.execute!(
        { name: 'master' },
        { messages: [], toolCallId: 'tc-8' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect((result as any).agents.length).toBe(1);
      expect((result as any).agents[0].id).toBe('a1');
    });

    it('returns empty list when no match', async () => {
      setupAgents([
        { id: 'a1', name: 'Master', role: 'master', visibility: 'visible', createdAt: new Date().toISOString() },
      ]);

      const tool = createFindAgentTool('a1');
      const result = await tool.execute!(
        { role: 'writer' },
        { messages: [], toolCallId: 'tc-9' } as any,
      );

      expect(result).toHaveProperty('ok', true);
      expect((result as any).agents.length).toBe(0);
    });
  });
});
