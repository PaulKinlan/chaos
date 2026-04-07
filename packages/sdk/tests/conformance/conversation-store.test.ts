import { describe, test, expect, beforeEach } from 'vitest';
import type { ConversationStore } from '../../src/stores/index.js';
import type { Conversation } from '../../src/types.js';
import { InMemoryConversationStore } from '../../src/stores/in-memory.js';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    agentId: 'agent-1',
    timestamp: '2024-06-01T12:00:00Z',
    messages: [
      { role: 'user', content: 'Hello', timestamp: '2024-06-01T12:00:00Z' },
      { role: 'assistant', content: 'Hi there!', timestamp: '2024-06-01T12:00:01Z' },
    ],
    ...overrides,
  };
}

function conversationStoreConformance(createStore: () => ConversationStore) {
  let store: ConversationStore;
  const agentId = 'agent-1';

  beforeEach(() => {
    store = createStore();
  });

  test('list returns empty array initially', async () => {
    const list = await store.list(agentId);
    expect(list).toEqual([]);
  });

  test('save and get a conversation', async () => {
    const conv = makeConversation();
    await store.save(agentId, conv);
    const result = await store.get(agentId, 'conv-1');
    expect(result).toEqual(conv);
  });

  test('get returns undefined for missing conversation', async () => {
    const result = await store.get(agentId, 'nonexistent');
    expect(result).toBeUndefined();
  });

  test('list returns saved conversations', async () => {
    await store.save(agentId, makeConversation({ id: 'c1', timestamp: '2024-06-01T10:00:00Z' }));
    await store.save(agentId, makeConversation({ id: 'c2', timestamp: '2024-06-01T11:00:00Z' }));
    const list = await store.list(agentId);
    expect(list).toHaveLength(2);
    expect(list.map(c => c.id).sort()).toEqual(['c1', 'c2']);
  });

  test('save overwrites existing conversation', async () => {
    await store.save(agentId, makeConversation());
    const updated = makeConversation({
      messages: [
        { role: 'user', content: 'Updated', timestamp: '2024-06-01T13:00:00Z' },
      ],
    });
    await store.save(agentId, updated);
    const result = await store.get(agentId, 'conv-1');
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0].content).toBe('Updated');
  });

  test('delete removes a conversation', async () => {
    await store.save(agentId, makeConversation());
    await store.delete(agentId, 'conv-1');
    const result = await store.get(agentId, 'conv-1');
    expect(result).toBeUndefined();
  });

  test('delete nonexistent conversation does not throw', async () => {
    await expect(store.delete(agentId, 'nonexistent')).resolves.toBeUndefined();
  });

  test('conversations are isolated per agent', async () => {
    await store.save('agent-a', makeConversation({ id: 'c1', agentId: 'agent-a' }));
    await store.save('agent-b', makeConversation({ id: 'c1', agentId: 'agent-b' }));
    const listA = await store.list('agent-a');
    const listB = await store.list('agent-b');
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
  });

  test('conversation with progress entries', async () => {
    const conv = makeConversation({
      messages: [
        {
          role: 'assistant',
          content: 'Result',
          timestamp: '2024-06-01T12:00:00Z',
          progress: [
            { type: 'thinking', content: 'Processing...', timestamp: '2024-06-01T12:00:00Z' },
            { type: 'tool-call', toolName: 'search', toolArgs: { q: 'test' }, timestamp: '2024-06-01T12:00:01Z' },
          ],
        },
      ],
    });
    await store.save(agentId, conv);
    const result = await store.get(agentId, 'conv-1');
    expect(result?.messages[0].progress).toHaveLength(2);
    expect(result?.messages[0].progress?.[1].toolName).toBe('search');
  });
}

describe('InMemoryConversationStore', () => {
  conversationStoreConformance(() => new InMemoryConversationStore());
});
