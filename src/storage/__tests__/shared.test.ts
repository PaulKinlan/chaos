import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appendMessage,
  getMessages,
  appendTaskEvent,
  getTaskState,
  getUnblockedTasks,
  publishArtifact,
  listArtifacts,
} from '../shared.js';
import { opfs } from '../opfs.js';
import type { AgentMessage, TaskEvent } from '../types.js';

// ── Mock OPFS ──

// We mock the opfs singleton so shared.ts tests run in Node without real OPFS.

vi.mock('../opfs.js', () => {
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
    // Expose store for test cleanup
    _store: store,
  };

  return { opfs: mockOpfs, OPFS: vi.fn(() => mockOpfs) };
});

beforeEach(() => {
  // Clear the in-memory store between tests
  (opfs as any)._store.clear();
  vi.clearAllMocks();
});

// ── Message bus tests ──

describe('Message bus', () => {
  const msg1: AgentMessage = {
    id: 'msg-1',
    from: 'agent-a',
    to: 'agent-b',
    timestamp: '2026-04-01T10:00:00Z',
    body: 'Hello B',
  };

  const msg2: AgentMessage = {
    id: 'msg-2',
    from: 'agent-b',
    to: 'agent-a',
    timestamp: '2026-04-01T11:00:00Z',
    body: 'Hello A',
  };

  const msg3: AgentMessage = {
    id: 'msg-3',
    from: 'agent-a',
    to: 'broadcast',
    timestamp: '2026-04-02T09:00:00Z',
    body: 'Announcement',
  };

  it('returns empty array when no messages exist', async () => {
    const msgs = await getMessages();
    expect(msgs).toEqual([]);
  });

  it('appends and reads messages', async () => {
    await appendMessage(msg1);
    await appendMessage(msg2);

    const msgs = await getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('msg-1');
    expect(msgs[1].id).toBe('msg-2');
  });

  it('filters by agentId (sender)', async () => {
    await appendMessage(msg1);
    await appendMessage(msg2);
    await appendMessage(msg3);

    const msgs = await getMessages({ agentId: 'agent-a' });
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.from === 'agent-a')).toBe(true);
  });

  it('filters by since timestamp', async () => {
    await appendMessage(msg1);
    await appendMessage(msg2);
    await appendMessage(msg3);

    const msgs = await getMessages({ since: '2026-04-02T00:00:00Z' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg-3');
  });

  it('limits results from the tail', async () => {
    await appendMessage(msg1);
    await appendMessage(msg2);
    await appendMessage(msg3);

    const msgs = await getMessages({ limit: 1 });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg-3');
  });

  it('combines filters', async () => {
    await appendMessage(msg1);
    await appendMessage(msg2);
    await appendMessage(msg3);

    const msgs = await getMessages({
      agentId: 'agent-a',
      since: '2026-04-02T00:00:00Z',
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg-3');
  });
});

// ── Task board tests (event sourcing) ──

describe('Task board', () => {
  it('returns empty array when no events exist', async () => {
    const tasks = await getTaskState();
    expect(tasks).toEqual([]);
  });

  it('creates a task from a created event', async () => {
    const event: TaskEvent = {
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: {
        subject: 'Research topic X',
        owner: 'agent-a',
        status: 'pending',
      },
    };

    await appendTaskEvent(event);
    const tasks = await getTaskState();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({
      id: 'task-1',
      subject: 'Research topic X',
      owner: 'agent-a',
      status: 'pending',
      description: undefined,
      blockedBy: undefined,
      result: undefined,
      createdAt: '2026-04-01T10:00:00Z',
      updatedAt: '2026-04-01T10:00:00Z',
    });
  });

  it('applies updates to an existing task', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Do something', status: 'pending' },
    });

    await appendTaskEvent({
      taskId: 'task-1',
      type: 'updated',
      timestamp: '2026-04-01T12:00:00Z',
      data: { status: 'in_progress', owner: 'agent-b' },
    });

    await appendTaskEvent({
      taskId: 'task-1',
      type: 'updated',
      timestamp: '2026-04-01T14:00:00Z',
      data: { status: 'completed', result: 'Done!' },
    });

    const tasks = await getTaskState();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].owner).toBe('agent-b');
    expect(tasks[0].result).toBe('Done!');
    expect(tasks[0].createdAt).toBe('2026-04-01T10:00:00Z');
    expect(tasks[0].updatedAt).toBe('2026-04-01T14:00:00Z');
  });

  it('ignores updates for nonexistent tasks', async () => {
    await appendTaskEvent({
      taskId: 'ghost',
      type: 'updated',
      timestamp: '2026-04-01T10:00:00Z',
      data: { status: 'completed' },
    });

    const tasks = await getTaskState();
    expect(tasks).toEqual([]);
  });

  it('handles multiple tasks independently', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Task one', status: 'pending' },
    });

    await appendTaskEvent({
      taskId: 'task-2',
      type: 'created',
      timestamp: '2026-04-01T10:05:00Z',
      data: { subject: 'Task two', status: 'pending', blockedBy: ['task-1'] },
    });

    const tasks = await getTaskState();
    expect(tasks).toHaveLength(2);
    expect(tasks[1].blockedBy).toEqual(['task-1']);
  });
});

// ── Dependency resolution tests ──

describe('getUnblockedTasks', () => {
  it('returns tasks with no dependencies', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Free task', status: 'pending' },
    });

    const unblocked = await getUnblockedTasks();
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe('task-1');
  });

  it('excludes tasks blocked by incomplete dependencies', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'First', status: 'pending' },
    });

    await appendTaskEvent({
      taskId: 'task-2',
      type: 'created',
      timestamp: '2026-04-01T10:05:00Z',
      data: { subject: 'Second', status: 'pending', blockedBy: ['task-1'] },
    });

    const unblocked = await getUnblockedTasks();
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe('task-1');
  });

  it('unblocks tasks when dependencies complete', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'First', status: 'pending' },
    });

    await appendTaskEvent({
      taskId: 'task-2',
      type: 'created',
      timestamp: '2026-04-01T10:05:00Z',
      data: { subject: 'Second', status: 'pending', blockedBy: ['task-1'] },
    });

    await appendTaskEvent({
      taskId: 'task-1',
      type: 'updated',
      timestamp: '2026-04-01T12:00:00Z',
      data: { status: 'completed' },
    });

    const unblocked = await getUnblockedTasks();
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe('task-2');
  });

  it('excludes completed and failed tasks from unblocked list', async () => {
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Done', status: 'completed' },
    });

    await appendTaskEvent({
      taskId: 'task-2',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Failed', status: 'failed' },
    });

    const unblocked = await getUnblockedTasks();
    expect(unblocked).toEqual([]);
  });

  it('handles diamond dependency graph', async () => {
    // A -> B, A -> C, B+C -> D
    await appendTaskEvent({
      taskId: 'A', type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'A', status: 'pending' },
    });
    await appendTaskEvent({
      taskId: 'B', type: 'created',
      timestamp: '2026-04-01T10:01:00Z',
      data: { subject: 'B', status: 'pending', blockedBy: ['A'] },
    });
    await appendTaskEvent({
      taskId: 'C', type: 'created',
      timestamp: '2026-04-01T10:02:00Z',
      data: { subject: 'C', status: 'pending', blockedBy: ['A'] },
    });
    await appendTaskEvent({
      taskId: 'D', type: 'created',
      timestamp: '2026-04-01T10:03:00Z',
      data: { subject: 'D', status: 'pending', blockedBy: ['B', 'C'] },
    });

    // Only A is unblocked initially
    let unblocked = await getUnblockedTasks();
    expect(unblocked.map((t) => t.id)).toEqual(['A']);

    // Complete A -> B and C unblocked
    await appendTaskEvent({
      taskId: 'A', type: 'updated',
      timestamp: '2026-04-01T11:00:00Z',
      data: { status: 'completed' },
    });
    unblocked = await getUnblockedTasks();
    expect(unblocked.map((t) => t.id).sort()).toEqual(['B', 'C']);

    // Complete B -> still blocked (C not done)
    await appendTaskEvent({
      taskId: 'B', type: 'updated',
      timestamp: '2026-04-01T12:00:00Z',
      data: { status: 'completed' },
    });
    unblocked = await getUnblockedTasks();
    expect(unblocked.map((t) => t.id)).toEqual(['C']);

    // Complete C -> D unblocked
    await appendTaskEvent({
      taskId: 'C', type: 'updated',
      timestamp: '2026-04-01T13:00:00Z',
      data: { status: 'completed' },
    });
    unblocked = await getUnblockedTasks();
    expect(unblocked.map((t) => t.id)).toEqual(['D']);
  });
});

// ── Artifact tests ──

describe('Artifacts', () => {
  it('returns empty array when no artifacts exist', async () => {
    const artifacts = await listArtifacts();
    expect(artifacts).toEqual([]);
  });

  it('publishes and lists artifacts', async () => {
    await publishArtifact('agent-a', '/shared/artifacts/report.md', 'Weekly report');
    await publishArtifact('agent-b', '/shared/artifacts/data.csv', 'Raw data');

    const artifacts = await listArtifacts();
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].agentId).toBe('agent-a');
    expect(artifacts[0].path).toBe('/shared/artifacts/report.md');
    expect(artifacts[1].agentId).toBe('agent-b');
  });

  it('filters artifacts by agentId', async () => {
    await publishArtifact('agent-a', '/shared/artifacts/a.md', 'From A');
    await publishArtifact('agent-b', '/shared/artifacts/b.md', 'From B');
    await publishArtifact('agent-a', '/shared/artifacts/a2.md', 'Also from A');

    const artifacts = await listArtifacts({ agentId: 'agent-a' });
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((a) => a.agentId === 'agent-a')).toBe(true);
  });
});
