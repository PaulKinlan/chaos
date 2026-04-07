import { describe, test, expect, beforeEach } from 'vitest';
import type { MemoryStore } from '../../src/stores/index.js';
import { InMemoryMemoryStore } from '../../src/stores/in-memory.js';

function memoryStoreConformance(createStore: () => MemoryStore) {
  let store: MemoryStore;
  const agentId = 'agent-1';

  beforeEach(() => {
    store = createStore();
  });

  test('write and read a file', async () => {
    await store.write(agentId, 'memories/user.md', '# User\nName: Paul');
    const content = await store.read(agentId, 'memories/user.md');
    expect(content).toBe('# User\nName: Paul');
  });

  test('read nonexistent file throws', async () => {
    await expect(store.read(agentId, 'nonexistent.md')).rejects.toThrow();
  });

  test('write to nested path creates parent dirs', async () => {
    await store.write(agentId, 'a/b/c/file.txt', 'deep');
    const content = await store.read(agentId, 'a/b/c/file.txt');
    expect(content).toBe('deep');
  });

  test('list directory contents', async () => {
    await store.write(agentId, 'dir/file1.md', 'one');
    await store.write(agentId, 'dir/file2.md', 'two');
    await store.mkdir(agentId, 'dir/subdir');
    const entries = await store.list(agentId, 'dir');
    expect(entries).toHaveLength(3);
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(['file1.md', 'file2.md', 'subdir']);
  });

  test('list root returns top-level entries', async () => {
    await store.write(agentId, 'top.md', 'content');
    await store.mkdir(agentId, 'folder');
    const entries = await store.list(agentId);
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  test('delete removes the file', async () => {
    await store.write(agentId, 'deleteme.md', 'bye');
    await store.delete(agentId, 'deleteme.md');
    await expect(store.read(agentId, 'deleteme.md')).rejects.toThrow();
  });

  test('append to existing file', async () => {
    await store.write(agentId, 'log.md', 'line1\n');
    await store.append(agentId, 'log.md', 'line2\n');
    const content = await store.read(agentId, 'log.md');
    expect(content).toBe('line1\nline2\n');
  });

  test('append to nonexistent file creates it', async () => {
    await store.append(agentId, 'new.md', 'fresh');
    const content = await store.read(agentId, 'new.md');
    expect(content).toBe('fresh');
  });

  test('exists returns true for existing file', async () => {
    await store.write(agentId, 'check.md', 'data');
    expect(await store.exists(agentId, 'check.md')).toBe(true);
  });

  test('exists returns false for missing file', async () => {
    expect(await store.exists(agentId, 'nope.md')).toBe(false);
  });

  test('search finds matching content', async () => {
    await store.write(agentId, 'doc1.md', 'hello world\ngoodbye');
    await store.write(agentId, 'doc2.md', 'hello universe');
    const results = await store.search(agentId, 'hello');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every(r => r.line.includes('hello'))).toBe(true);
  });

  test('mkdir creates a directory that can be listed', async () => {
    await store.mkdir(agentId, 'newdir');
    expect(await store.exists(agentId, 'newdir')).toBe(true);
  });

  test('different agents have isolated storage', async () => {
    await store.write('agent-a', 'file.md', 'from A');
    await store.write('agent-b', 'file.md', 'from B');
    expect(await store.read('agent-a', 'file.md')).toBe('from A');
    expect(await store.read('agent-b', 'file.md')).toBe('from B');
  });
}

describe('InMemoryMemoryStore', () => {
  memoryStoreConformance(() => new InMemoryMemoryStore());
});
