import { describe, test, expect, beforeEach } from 'vitest';
import type { UsageStore } from '../../src/stores/index.js';
import type { UsageRecord } from '../../src/types.js';
import { InMemoryUsageStore } from '../../src/stores/in-memory.js';

function makeUsageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: 'usage-1',
    timestamp: '2024-06-01T12:00:00Z',
    agentId: 'agent-1',
    agentName: 'Test Agent',
    provider: 'anthropic',
    model: 'claude-3',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCost: 0.005,
    source: 'chat',
    ...overrides,
  };
}

function usageStoreConformance(createStore: () => UsageStore) {
  let store: UsageStore;

  beforeEach(() => {
    store = createStore();
  });

  test('query returns empty array initially', async () => {
    const records = await store.query();
    expect(records).toEqual([]);
  });

  test('record and query', async () => {
    const record = makeUsageRecord();
    await store.record(record);
    const results = await store.query();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(record);
  });

  test('query filters by agentId', async () => {
    await store.record(makeUsageRecord({ id: 'u1', agentId: 'a1' }));
    await store.record(makeUsageRecord({ id: 'u2', agentId: 'a2' }));
    const results = await store.query({ agentId: 'a1' });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('a1');
  });

  test('query filters by provider', async () => {
    await store.record(makeUsageRecord({ id: 'u1', provider: 'anthropic' }));
    await store.record(makeUsageRecord({ id: 'u2', provider: 'openai' }));
    const results = await store.query({ provider: 'openai' });
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('openai');
  });

  test('query filters by since', async () => {
    await store.record(makeUsageRecord({ id: 'u1', timestamp: '2024-01-01T00:00:00Z' }));
    await store.record(makeUsageRecord({ id: 'u2', timestamp: '2024-06-15T00:00:00Z' }));
    const results = await store.query({ since: '2024-06-01T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('u2');
  });

  test('query respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await store.record(makeUsageRecord({ id: `u${i}` }));
    }
    const results = await store.query({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  test('clear removes all records', async () => {
    await store.record(makeUsageRecord({ id: 'u1' }));
    await store.record(makeUsageRecord({ id: 'u2' }));
    await store.clear();
    const results = await store.query();
    expect(results).toEqual([]);
  });

  test('multiple filters combine correctly', async () => {
    await store.record(makeUsageRecord({ id: 'u1', agentId: 'a1', provider: 'anthropic' }));
    await store.record(makeUsageRecord({ id: 'u2', agentId: 'a1', provider: 'openai' }));
    await store.record(makeUsageRecord({ id: 'u3', agentId: 'a2', provider: 'anthropic' }));
    const results = await store.query({ agentId: 'a1', provider: 'anthropic' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('u1');
  });
}

describe('InMemoryUsageStore', () => {
  usageStoreConformance(() => new InMemoryUsageStore());
});
