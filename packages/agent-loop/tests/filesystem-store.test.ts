import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemMemoryStore } from '../src/stores/filesystem.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('FilesystemMemoryStore', () => {
  let store: FilesystemMemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-test-'));
    store = new FilesystemMemoryStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('write and read', () => {
    it('writes and reads a file', async () => {
      await store.write('agent-1', 'hello.txt', 'Hello World');
      const content = await store.read('agent-1', 'hello.txt');
      expect(content).toBe('Hello World');
    });

    it('creates parent directories automatically', async () => {
      await store.write('agent-1', 'a/b/c/deep.txt', 'deep');
      expect(fs.existsSync(path.join(tmpDir, 'agent-1', 'a', 'b', 'c', 'deep.txt'))).toBe(true);
    });

    it('persists to actual filesystem', async () => {
      await store.write('agent-1', 'real.txt', 'on disk');
      const onDisk = fs.readFileSync(path.join(tmpDir, 'agent-1', 'real.txt'), 'utf-8');
      expect(onDisk).toBe('on disk');
    });

    it('isolates agents', async () => {
      await store.write('a1', 'file.txt', 'agent 1');
      await store.write('a2', 'file.txt', 'agent 2');
      expect(await store.read('a1', 'file.txt')).toBe('agent 1');
      expect(await store.read('a2', 'file.txt')).toBe('agent 2');
    });

    it('throws for missing files', async () => {
      await expect(store.read('agent-1', 'nope.txt')).rejects.toThrow('File not found');
    });

    it('blocks path traversal', async () => {
      await expect(store.write('agent-1', '../../etc/passwd', 'bad')).rejects.toThrow('Path traversal');
    });
  });

  describe('append', () => {
    it('appends to existing file', async () => {
      await store.write('agent-1', 'log.txt', 'line1\n');
      await store.append('agent-1', 'log.txt', 'line2\n');
      expect(await store.read('agent-1', 'log.txt')).toBe('line1\nline2\n');
    });

    it('creates file if missing', async () => {
      await store.append('agent-1', 'new.txt', 'first');
      expect(await store.read('agent-1', 'new.txt')).toBe('first');
    });
  });

  describe('delete', () => {
    it('deletes a file', async () => {
      await store.write('agent-1', 'temp.txt', 'data');
      await store.delete('agent-1', 'temp.txt');
      expect(await store.exists('agent-1', 'temp.txt')).toBe(false);
    });

    it('does not throw for missing files', async () => {
      await expect(store.delete('agent-1', 'nope.txt')).resolves.toBeUndefined();
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

    it('returns file sizes', async () => {
      await store.write('agent-1', 'sized.txt', 'hello');
      const entries = await store.list('agent-1');
      const file = entries.find(e => e.name === 'sized.txt');
      expect(file?.size).toBe(5);
    });

    it('returns empty for nonexistent directory', async () => {
      expect(await store.list('agent-1', 'nope')).toEqual([]);
    });
  });

  describe('mkdir', () => {
    it('creates nested directories', async () => {
      await store.mkdir('agent-1', 'a/b/c');
      expect(fs.existsSync(path.join(tmpDir, 'agent-1', 'a', 'b', 'c'))).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true for files', async () => {
      await store.write('agent-1', 'file.txt', 'data');
      expect(await store.exists('agent-1', 'file.txt')).toBe(true);
    });

    it('returns true for directories', async () => {
      await store.mkdir('agent-1', 'dir');
      expect(await store.exists('agent-1', 'dir')).toBe(true);
    });

    it('returns false for missing paths', async () => {
      expect(await store.exists('agent-1', 'nope')).toBe(false);
    });
  });

  describe('search', () => {
    it('finds matching lines', async () => {
      await store.write('agent-1', 'notes.txt', 'hello world\ngoodbye world');
      await store.write('agent-1', 'other.txt', 'no match');

      const results = await store.search('agent-1', 'hello');
      expect(results.length).toBe(1);
      expect(results[0]!.line).toContain('hello world');
    });

    it('searches recursively', async () => {
      await store.write('agent-1', 'a/deep.txt', 'findme here');
      const results = await store.search('agent-1', 'findme');
      expect(results.length).toBe(1);
      expect(results[0]!.path).toContain('deep.txt');
    });
  });
});
