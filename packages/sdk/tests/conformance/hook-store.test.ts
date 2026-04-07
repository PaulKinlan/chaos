import { describe, test, expect, beforeEach } from 'vitest';
import type { HookStore } from '../../src/stores/index.js';
import type { Hook } from '../../src/types.js';
import { InMemoryHookStore } from '../../src/stores/in-memory.js';

function makeHook(overrides: Partial<Hook> = {}): Hook {
  return {
    id: 'hook-1',
    agentId: 'agent-1',
    trigger: { type: 'tab-created' },
    prompt: 'Summarize the new tab',
    description: 'Tab summary hook',
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    triggerCount: 0,
    ...overrides,
  };
}

function hookStoreConformance(createStore: () => HookStore) {
  let store: HookStore;

  beforeEach(() => {
    store = createStore();
  });

  test('list returns empty array initially', async () => {
    const hooks = await store.list();
    expect(hooks).toEqual([]);
  });

  test('add and get a hook', async () => {
    const hook = makeHook();
    await store.add(hook);
    const result = await store.get('hook-1');
    expect(result).toEqual(hook);
  });

  test('get returns undefined for missing hook', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('list all hooks', async () => {
    await store.add(makeHook({ id: 'h1', agentId: 'a1' }));
    await store.add(makeHook({ id: 'h2', agentId: 'a2' }));
    const hooks = await store.list();
    expect(hooks).toHaveLength(2);
  });

  test('list filters by agentId', async () => {
    await store.add(makeHook({ id: 'h1', agentId: 'a1' }));
    await store.add(makeHook({ id: 'h2', agentId: 'a2' }));
    await store.add(makeHook({ id: 'h3', agentId: 'a1' }));
    const hooks = await store.list('a1');
    expect(hooks).toHaveLength(2);
    expect(hooks.every(h => h.agentId === 'a1')).toBe(true);
  });

  test('update modifies a hook', async () => {
    await store.add(makeHook());
    await store.update('hook-1', { enabled: false, triggerCount: 5 });
    const result = await store.get('hook-1');
    expect(result?.enabled).toBe(false);
    expect(result?.triggerCount).toBe(5);
    expect(result?.prompt).toBe('Summarize the new tab'); // unchanged
  });

  test('update throws for nonexistent hook', async () => {
    await expect(store.update('nonexistent', { enabled: false })).rejects.toThrow();
  });

  test('remove deletes a hook', async () => {
    await store.add(makeHook());
    await store.remove('hook-1');
    const result = await store.get('hook-1');
    expect(result).toBeUndefined();
  });

  test('hook with complex trigger type', async () => {
    const hook = makeHook({
      id: 'complex',
      trigger: { type: 'tab-navigated', urlPattern: '*://example.com/*' },
    });
    await store.add(hook);
    const result = await store.get('complex');
    expect(result?.trigger).toEqual({ type: 'tab-navigated', urlPattern: '*://example.com/*' });
  });
}

describe('InMemoryHookStore', () => {
  hookStoreConformance(() => new InMemoryHookStore());
});
