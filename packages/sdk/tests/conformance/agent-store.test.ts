import { describe, test, expect, beforeEach } from 'vitest';
import type { AgentStore } from '../../src/stores/index.js';
import type { AgentMeta } from '../../src/types.js';
import { InMemoryAgentStore } from '../../src/stores/in-memory.js';

function makeAgent(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    role: 'assistant',
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function agentStoreConformance(createStore: () => AgentStore) {
  let store: AgentStore;

  beforeEach(() => {
    store = createStore();
  });

  test('list returns empty array initially', async () => {
    const agents = await store.list();
    expect(agents).toEqual([]);
  });

  test('add and get an agent', async () => {
    const agent = makeAgent();
    await store.add(agent);
    const result = await store.get('agent-1');
    expect(result).toEqual(agent);
  });

  test('get returns undefined for missing agent', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('list returns all added agents', async () => {
    await store.add(makeAgent({ id: 'a1', name: 'Agent 1' }));
    await store.add(makeAgent({ id: 'a2', name: 'Agent 2' }));
    const agents = await store.list();
    expect(agents).toHaveLength(2);
  });

  test('update modifies an existing agent', async () => {
    await store.add(makeAgent());
    await store.update('agent-1', { name: 'Updated Name' });
    const result = await store.get('agent-1');
    expect(result?.name).toBe('Updated Name');
    expect(result?.role).toBe('assistant'); // unchanged
  });

  test('update throws for nonexistent agent', async () => {
    await expect(store.update('nonexistent', { name: 'X' })).rejects.toThrow();
  });

  test('remove deletes an agent', async () => {
    await store.add(makeAgent());
    await store.remove('agent-1');
    const result = await store.get('agent-1');
    expect(result).toBeUndefined();
  });

  test('remove nonexistent agent does not throw', async () => {
    await expect(store.remove('nonexistent')).resolves.toBeUndefined();
  });

  test('add agent with all optional fields', async () => {
    const agent = makeAgent({
      id: 'full',
      enabledTools: ['tool1'],
      disabledTools: ['tool2'],
      master: true,
      temporary: false,
      createdBy: 'user',
      provider: 'anthropic',
      model: 'claude-3',
      bookmarkFolderId: 'folder-1',
    });
    await store.add(agent);
    const result = await store.get('full');
    expect(result).toEqual(agent);
  });
}

describe('InMemoryAgentStore', () => {
  agentStoreConformance(() => new InMemoryAgentStore());
});
