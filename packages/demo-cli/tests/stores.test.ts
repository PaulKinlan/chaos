/**
 * Conformance tests for the demo-cli's filesystem-backed stores.
 * Proves they satisfy the same contracts as the in-memory stores.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { NodeFileStore } from '../src/stores/node-file-store.js';
import { JsonSettingsStore } from '../src/stores/json-settings-store.js';

// Use a temp directory so tests don't pollute the real filesystem
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaos-test-'));
});

afterAll(async () => {
  // Clean up temp dirs
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('NodeFileStore (MemoryStore conformance)', () => {
  let store: NodeFileStore;
  const agentId = 'agent-1';

  beforeEach(() => {
    store = new NodeFileStore(path.join(tmpDir, 'memory'));
  });

  test('write and read a file', async () => {
    await store.write(agentId, 'memories/user.md', '# User\nName: Paul');
    const content = await store.read(agentId, 'memories/user.md');
    expect(content).toBe('# User\nName: Paul');
  });

  test('read nonexistent file throws', async () => {
    await expect(store.read(agentId, 'nonexistent.md')).rejects.toThrow();
  });

  test('list directory contents', async () => {
    await store.write(agentId, 'memories/user.md', 'user');
    await store.write(agentId, 'memories/work.md', 'work');
    const entries = await store.list(agentId, 'memories');
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('user.md');
    expect(names).toContain('work.md');
  });

  test('delete removes a file', async () => {
    await store.write(agentId, 'test.md', 'data');
    await store.delete(agentId, 'test.md');
    await expect(store.read(agentId, 'test.md')).rejects.toThrow();
  });

  test('exists returns true for existing files', async () => {
    await store.write(agentId, 'test.md', 'data');
    expect(await store.exists(agentId, 'test.md')).toBe(true);
  });

  test('exists returns false for missing files', async () => {
    expect(await store.exists(agentId, 'missing.md')).toBe(false);
  });

  test('mkdir creates directories', async () => {
    await store.mkdir(agentId, 'deep/nested/dir');
    expect(await store.exists(agentId, 'deep/nested/dir')).toBe(true);
  });

  test('append adds to existing file', async () => {
    await store.write(agentId, 'log.txt', 'line1\n');
    await store.append(agentId, 'log.txt', 'line2\n');
    const content = await store.read(agentId, 'log.txt');
    expect(content).toBe('line1\nline2\n');
  });

  test('write creates parent directories', async () => {
    await store.write(agentId, 'a/b/c/file.md', 'deep');
    const content = await store.read(agentId, 'a/b/c/file.md');
    expect(content).toBe('deep');
  });

  test('search finds matching content', async () => {
    await store.write(agentId, 'notes.md', 'hello world\nfoo bar');
    await store.write(agentId, 'other.md', 'no match here');
    const results = await store.search(agentId, 'hello');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.path.includes('notes.md'))).toBe(true);
  });
});

describe('JsonSettingsStore (SettingsStore conformance)', () => {
  let store: JsonSettingsStore;

  beforeEach(() => {
    store = new JsonSettingsStore(path.join(tmpDir, 'settings.json'));
  });

  test('get returns undefined for missing key', async () => {
    expect(await store.get('missing')).toBeUndefined();
  });

  test('set and get a value', async () => {
    await store.set('theme', 'dark');
    expect(await store.get('theme')).toBe('dark');
  });

  test('set overwrites existing value', async () => {
    await store.set('theme', 'dark');
    await store.set('theme', 'light');
    expect(await store.get('theme')).toBe('light');
  });

  test('remove deletes a key', async () => {
    await store.set('key', 'value');
    await store.remove('key');
    expect(await store.get('key')).toBeUndefined();
  });

  test('getMultiple returns all matching keys', async () => {
    await store.set('a', 1);
    await store.set('b', 2);
    await store.set('c', 3);
    const result = await store.getMultiple(['a', 'c']);
    expect(result).toEqual({ a: 1, c: 3 });
  });

  test('handles complex values', async () => {
    const val = { nested: { array: [1, 2, 3] } };
    await store.set('complex', val);
    expect(await store.get('complex')).toEqual(val);
  });

  test('persists across instances', async () => {
    const filePath = path.join(tmpDir, 'persist-test.json');
    const store1 = new JsonSettingsStore(filePath);
    await store1.set('key', 'persisted');

    const store2 = new JsonSettingsStore(filePath);
    expect(await store2.get('key')).toBe('persisted');
  });
});
