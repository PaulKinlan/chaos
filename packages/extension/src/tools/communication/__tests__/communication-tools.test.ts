import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentMeta } from '../../../storage/types.js';

// ── Mock OPFS ──

const store = new Map<string, string>();

vi.mock('../../../storage/opfs.js', () => {
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
  };

  return { opfs: mockOpfs, OPFS: vi.fn(() => mockOpfs) };
});

// ── Mock chrome.storage ──

const mockAgents: AgentMeta[] = [
  { id: 'agent-a', name: 'Alice', role: 'researcher', visibility: 'visible', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'agent-b', name: 'Bob', role: 'writer', visibility: 'open', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'agent-c', name: 'Charlie', role: 'coder', visibility: 'private', createdAt: '2026-01-01T00:00:00Z' },
];

vi.mock('../../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(async () => mockAgents),
  getApiKeys: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({ activeProvider: 'anthropic', theme: 'system' })),
}));

// ── Mock crypto.randomUUID ──

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// ── Imports (after mocks) ──

import { createMessageSendTool } from '../message-send.js';
import { createMessageReadTool } from '../message-read.js';
import { createTaskCreateTool } from '../task-create.js';
import { createTaskUpdateTool } from '../task-update.js';
import { createTaskListTool } from '../task-list.js';
import { createArtifactPublishTool } from '../artifact-publish.js';
import { createArtifactListTool } from '../artifact-list.js';
import { createArtifactReadTool } from '../artifact-read.js';
import { createAgentDiscoverTool } from '../agent-discover.js';
import { getCommunicationTools } from '../index.js';

beforeEach(() => {
  store.clear();
  uuidCounter = 0;
  vi.clearAllMocks();
});

// ── Message send/read round-trip ──

describe('Message send/read round-trip', () => {
  it('sends a message and reads it on the receiving end', async () => {
    const send = createMessageSendTool('agent-a');
    const read = createMessageReadTool('agent-b');

    // Agent A sends to Agent B
    const sendResult = await (send.execute! as any)(
      { to: 'agent-b', body: 'Hello Bob!' },
      { toolCallId: 'tc1', messages: [] },
    );

    expect(sendResult.ok).toBe(true);
    expect(sendResult.messageId).toBeDefined();
    expect(sendResult.to).toBe('agent-b');

    // Agent B reads messages
    const messages = await (read.execute! as any)(
      { since: undefined, limit: 20 },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe('agent-a');
    expect(messages[0].to).toBe('agent-b');
    expect(messages[0].body).toBe('Hello Bob!');
  });

  it('reads broadcast messages', async () => {
    const send = createMessageSendTool('agent-a');
    const read = createMessageReadTool('agent-b');

    await (send.execute! as any)(
      { to: 'broadcast', body: 'Hello everyone!' },
      { toolCallId: 'tc1', messages: [] },
    );

    const messages = await (read.execute! as any)(
      { since: undefined, limit: 20 },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe('broadcast');
    expect(messages[0].body).toBe('Hello everyone!');
  });

  it('does not return messages addressed to other agents', async () => {
    const send = createMessageSendTool('agent-a');
    const readC = createMessageReadTool('agent-c');

    await (send.execute! as any)(
      { to: 'agent-b', body: 'Private to B' },
      { toolCallId: 'tc1', messages: [] },
    );

    const messages = await (readC.execute! as any)(
      { since: undefined, limit: 20 },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(messages).toHaveLength(0);
  });

  it('filters messages by since timestamp', async () => {
    const send = createMessageSendTool('agent-a');
    const read = createMessageReadTool('agent-b');

    // Manually write an old message
    const oldMsg = JSON.stringify({
      id: 'old-msg', from: 'agent-a', to: 'agent-b',
      timestamp: '2026-01-01T00:00:00Z', body: 'Old message',
    }) + '\n';
    store.set('shared/messages.jsonl', oldMsg);

    await (send.execute! as any)(
      { to: 'agent-b', body: 'New message' },
      { toolCallId: 'tc1', messages: [] },
    );

    const messages = await (read.execute! as any)(
      { since: '2026-03-01T00:00:00Z', limit: 20 },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('New message');
  });

  it('respects the limit parameter', async () => {
    const send = createMessageSendTool('agent-a');
    const read = createMessageReadTool('agent-b');

    for (let i = 0; i < 5; i++) {
      await (send.execute! as any)(
        { to: 'agent-b', body: `Message ${i}` },
        { toolCallId: `tc${i}`, messages: [] },
      );
    }

    const messages = await (read.execute! as any)(
      { since: undefined, limit: 2 },
      { toolCallId: 'tc-read', messages: [] },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].body).toBe('Message 3');
    expect(messages[1].body).toBe('Message 4');
  });
});

// ── Task create/update/list lifecycle ──

describe('Task create/update/list lifecycle', () => {
  it('creates a task and lists it', async () => {
    const create = createTaskCreateTool('agent-a');
    const list = createTaskListTool('agent-a');

    const result = await (create.execute! as any)(
      { subject: 'Research AI safety', description: 'Gather papers', owner: 'agent-a', blockedBy: undefined },
      { toolCallId: 'tc1', messages: [] },
    );

    expect(result.ok).toBe(true);
    expect(result.taskId).toBeDefined();
    expect(result.subject).toBe('Research AI safety');

    const tasks = await (list.execute! as any)(
      { agentId: undefined, status: undefined, unblockedOnly: false },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Research AI safety');
    expect(tasks[0].status).toBe('pending');
    expect(tasks[0].owner).toBe('agent-a');
  });

  it('updates a task status', async () => {
    const create = createTaskCreateTool('agent-a');
    const update = createTaskUpdateTool('agent-a');
    const list = createTaskListTool('agent-a');

    const createResult = await (create.execute! as any)(
      { subject: 'Write draft', owner: 'agent-b', description: undefined, blockedBy: undefined },
      { toolCallId: 'tc1', messages: [] },
    );

    await (update.execute! as any)(
      { taskId: createResult.taskId, status: 'in_progress', result: undefined },
      { toolCallId: 'tc2', messages: [] },
    );

    let tasks = await (list.execute! as any)(
      { agentId: undefined, status: undefined, unblockedOnly: false },
      { toolCallId: 'tc3', messages: [] },
    );
    expect(tasks[0].status).toBe('in_progress');

    await (update.execute! as any)(
      { taskId: createResult.taskId, status: 'completed', result: 'Draft is done' },
      { toolCallId: 'tc4', messages: [] },
    );

    tasks = await (list.execute! as any)(
      { agentId: undefined, status: undefined, unblockedOnly: false },
      { toolCallId: 'tc5', messages: [] },
    );
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].result).toBe('Draft is done');
  });

  it('filters tasks by agentId', async () => {
    const create = createTaskCreateTool('agent-a');
    const list = createTaskListTool('agent-a');

    await (create.execute! as any)(
      { subject: 'Task for A', owner: 'agent-a', description: undefined, blockedBy: undefined },
      { toolCallId: 'tc1', messages: [] },
    );
    await (create.execute! as any)(
      { subject: 'Task for B', owner: 'agent-b', description: undefined, blockedBy: undefined },
      { toolCallId: 'tc2', messages: [] },
    );

    const tasks = await (list.execute! as any)(
      { agentId: 'agent-a', status: undefined, unblockedOnly: false },
      { toolCallId: 'tc3', messages: [] },
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Task for A');
  });

  it('filters tasks by status', async () => {
    const create = createTaskCreateTool('agent-a');
    const update = createTaskUpdateTool('agent-a');
    const list = createTaskListTool('agent-a');

    const r1 = await (create.execute! as any)(
      { subject: 'Pending task', description: undefined, owner: undefined, blockedBy: undefined },
      { toolCallId: 'tc1', messages: [] },
    );
    await (create.execute! as any)(
      { subject: 'Another task', description: undefined, owner: undefined, blockedBy: undefined },
      { toolCallId: 'tc2', messages: [] },
    );

    await (update.execute! as any)(
      { taskId: r1.taskId, status: 'completed', result: undefined },
      { toolCallId: 'tc3', messages: [] },
    );

    const tasks = await (list.execute! as any)(
      { agentId: undefined, status: 'pending', unblockedOnly: false },
      { toolCallId: 'tc4', messages: [] },
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Another task');
  });

  it('lists only unblocked tasks', async () => {
    const create = createTaskCreateTool('agent-a');
    const list = createTaskListTool('agent-a');

    const r1 = await (create.execute! as any)(
      { subject: 'First', description: undefined, owner: undefined, blockedBy: undefined },
      { toolCallId: 'tc1', messages: [] },
    );
    await (create.execute! as any)(
      { subject: 'Second', description: undefined, owner: undefined, blockedBy: [r1.taskId] },
      { toolCallId: 'tc2', messages: [] },
    );

    const tasks = await (list.execute! as any)(
      { agentId: undefined, status: undefined, unblockedOnly: true },
      { toolCallId: 'tc3', messages: [] },
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('First');
  });
});

// ── Artifact publish/list/read round-trip ──

describe('Artifact publish/list/read round-trip', () => {
  it('publishes, lists, and reads an artifact', async () => {
    const publish = createArtifactPublishTool('agent-a');
    const list = createArtifactListTool('agent-a');
    const read = createArtifactReadTool('agent-b');

    // Write a file to the agent's private storage first
    store.set('agents/agent-a/research/report.md', '# Report\n\nFindings here.');

    const pubResult = await (publish.execute! as any)(
      { path: 'research/report.md', description: 'Research report' },
      { toolCallId: 'tc1', messages: [] },
    );

    expect(pubResult.ok).toBe(true);
    expect(pubResult.artifactPath).toBe('shared/artifacts/agent-a/research/report.md');

    // List artifacts
    const artifacts = await (list.execute! as any)(
      { agentId: undefined },
      { toolCallId: 'tc2', messages: [] },
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].agentId).toBe('agent-a');
    expect(artifacts[0].description).toBe('Research report');

    // Read the artifact
    const readResult = await (read.execute! as any)(
      { path: pubResult.artifactPath as string },
      { toolCallId: 'tc3', messages: [] },
    );

    expect(readResult.ok).toBe(true);
    expect(readResult.content).toBe('# Report\n\nFindings here.');
  });

  it('returns error when publishing a non-existent file', async () => {
    const publish = createArtifactPublishTool('agent-a');

    const result = await (publish.execute! as any)(
      { path: 'nonexistent.md', description: 'Missing file' },
      { toolCallId: 'tc1', messages: [] },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when reading a non-existent artifact', async () => {
    const read = createArtifactReadTool('agent-a');

    const result = await (read.execute! as any)(
      { path: 'shared/artifacts/nonexistent.md' },
      { toolCallId: 'tc1', messages: [] },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('filters artifacts by agentId', async () => {
    const publishA = createArtifactPublishTool('agent-a');
    const publishB = createArtifactPublishTool('agent-b');
    const list = createArtifactListTool('agent-a');

    store.set('agents/agent-a/file-a.md', 'Content A');
    store.set('agents/agent-b/file-b.md', 'Content B');

    await (publishA.execute! as any)(
      { path: 'file-a.md', description: 'File from A' },
      { toolCallId: 'tc1', messages: [] },
    );
    await (publishB.execute! as any)(
      { path: 'file-b.md', description: 'File from B' },
      { toolCallId: 'tc2', messages: [] },
    );

    const artifacts = await (list.execute! as any)(
      { agentId: 'agent-a' },
      { toolCallId: 'tc3', messages: [] },
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].agentId).toBe('agent-a');
  });
});

// ── Agent discovery ──

describe('Agent discovery', () => {
  it('returns visible and open agents, excluding self and private agents', async () => {
    const discover = createAgentDiscoverTool('agent-a');

    const agents = await (discover.execute! as any)(
      {},
      { toolCallId: 'tc1', messages: [] },
    );

    // agent-a is self (excluded), agent-b is open (included), agent-c is private (excluded)
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      id: 'agent-b',
      name: 'Bob',
      role: 'writer',
      visibility: 'open',
    });
  });

  it('excludes only self when called by a different agent', async () => {
    const discover = createAgentDiscoverTool('agent-b');

    const agents = await (discover.execute! as any)(
      {},
      { toolCallId: 'tc1', messages: [] },
    );

    // agent-a is visible (included), agent-b is self (excluded), agent-c is private (excluded)
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('agent-a');
  });

  it('filters out all private agents', async () => {
    const discover = createAgentDiscoverTool('agent-c');

    const agents = await (discover.execute! as any)(
      {},
      { toolCallId: 'tc1', messages: [] },
    );

    // agent-a is visible, agent-b is open, agent-c is self
    expect(agents).toHaveLength(2);
    expect(agents.map((a: any) => a.id).sort()).toEqual(['agent-a', 'agent-b']);
  });
});

// ── getCommunicationTools integration ──

describe('getCommunicationTools', () => {
  it('returns all expected tool names', () => {
    const tools = getCommunicationTools('agent-a');

    expect(Object.keys(tools).sort()).toEqual([
      'agent_discover',
      'artifact_list',
      'artifact_publish',
      'artifact_read',
      'message_read',
      'message_send',
      'task_create',
      'task_list',
      'task_update',
    ]);
  });
});
