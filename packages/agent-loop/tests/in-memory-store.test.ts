import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryStore } from '../src/stores/in-memory.js';

describe('InMemoryMemoryStore', () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  describe('write and read', () => {
    it('writes and reads a file', async () => {
      await store.write('agent-1', 'hello.txt', 'Hello World');
      const content = await store.read('agent-1', 'hello.txt');
      expect(content).toBe('Hello World');
    });

    it('writes to nested paths', async () => {
      await store.write('agent-1', 'a/b/c/deep.txt', 'deep content');
      const content = await store.read('agent-1', 'a/b/c/deep.txt');
      expect(content).toBe('deep content');
    });

    it('overwrites existing files', async () => {
      await store.write('agent-1', 'file.txt', 'v1');
      await store.write('agent-1', 'file.txt', 'v2');
      expect(await store.read('agent-1', 'file.txt')).toBe('v2');
    });

    it('throws for missing files', async () => {
      await expect(store.read('agent-1', 'nope.txt')).rejects.toThrow('File not found');
    });

    it('isolates agents from each other', async () => {
      await store.write('agent-1', 'secret.txt', 'agent 1 data');
      await store.write('agent-2', 'secret.txt', 'agent 2 data');
      expect(await store.read('agent-1', 'secret.txt')).toBe('agent 1 data');
      expect(await store.read('agent-2', 'secret.txt')).toBe('agent 2 data');
    });
  });

  describe('append', () => {
    it('appends to existing file', async () => {
      await store.write('agent-1', 'log.txt', 'line 1\n');
      await store.append('agent-1', 'log.txt', 'line 2\n');
      expect(await store.read('agent-1', 'log.txt')).toBe('line 1\nline 2\n');
    });

    it('creates file if it does not exist', async () => {
      await store.append('agent-1', 'new.txt', 'first');
      expect(await store.read('agent-1', 'new.txt')).toBe('first');
    });
  });

  describe('delete', () => {
    it('deletes a file', async () => {
      await store.write('agent-1', 'temp.txt', 'data');
      await store.delete('agent-1', 'temp.txt');
      await expect(store.read('agent-1', 'temp.txt')).rejects.toThrow();
    });

    it('does not throw for missing files', async () => {
      await expect(store.delete('agent-1', 'nonexistent.txt')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists files and directories', async () => {
      await store.write('agent-1', 'a.txt', 'a');
      await store.write('agent-1', 'b.txt', 'b');
      await store.mkdir('agent-1', 'subdir');

      const entries = await store.list('agent-1');
      const names = entries.map(e => e.name).sort();
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
      expect(names).toContain('subdir');
    });

    it('lists subdirectory contents', async () => {
      await store.write('agent-1', 'dir/file1.txt', '1');
      await store.write('agent-1', 'dir/file2.txt', '2');
      const entries = await store.list('agent-1', 'dir');
      expect(entries).toHaveLength(2);
    });

    it('returns empty for nonexistent directory', async () => {
      const entries = await store.list('agent-1', 'nonexistent');
      expect(entries).toEqual([]);
    });
  });

  describe('mkdir', () => {
    it('creates a directory', async () => {
      await store.mkdir('agent-1', 'new-dir');
      const entries = await store.list('agent-1');
      expect(entries.find(e => e.name === 'new-dir')).toBeDefined();
    });

    it('creates nested directories', async () => {
      await store.mkdir('agent-1', 'a/b/c');
      expect(await store.exists('agent-1', 'a/b/c')).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true for existing files', async () => {
      await store.write('agent-1', 'file.txt', 'data');
      expect(await store.exists('agent-1', 'file.txt')).toBe(true);
    });

    it('returns true for existing directories', async () => {
      await store.mkdir('agent-1', 'dir');
      expect(await store.exists('agent-1', 'dir')).toBe(true);
    });

    it('returns false for nonexistent paths', async () => {
      expect(await store.exists('agent-1', 'nope')).toBe(false);
    });
  });

  describe('search', () => {
    it('finds matching lines across files', async () => {
      await store.write('agent-1', 'a.txt', 'hello world\ngoodbye world');
      await store.write('agent-1', 'b.txt', 'no match here');
      await store.write('agent-1', 'c.txt', 'hello again');

      const results = await store.search('agent-1', 'hello');
      expect(results.length).toBe(2);
      expect(results.some(r => r.line.includes('hello world'))).toBe(true);
      expect(results.some(r => r.line.includes('hello again'))).toBe(true);
    });

    it('searches within a subdirectory', async () => {
      await store.write('agent-1', 'root.txt', 'match here');
      await store.write('agent-1', 'sub/nested.txt', 'match here too');

      const results = await store.search('agent-1', 'match', 'sub');
      expect(results.length).toBe(1);
      expect(results[0]!.path).toContain('nested.txt');
    });

    it('returns empty for no matches', async () => {
      await store.write('agent-1', 'file.txt', 'nothing relevant');
      const results = await store.search('agent-1', 'zzzzz');
      expect(results).toEqual([]);
    });
  });
});
