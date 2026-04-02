import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OPFS } from '../opfs.js';

// ── Path splitting tests (pure logic, no mocking needed) ──

describe('OPFS.splitPath', () => {
  it('splits a simple path', () => {
    expect(OPFS.splitPath('agents/abc/memories')).toEqual([
      'agents',
      'abc',
      'memories',
    ]);
  });

  it('handles leading slash', () => {
    expect(OPFS.splitPath('/agents/abc')).toEqual(['agents', 'abc']);
  });

  it('handles trailing slash', () => {
    expect(OPFS.splitPath('agents/abc/')).toEqual(['agents', 'abc']);
  });

  it('handles multiple consecutive slashes', () => {
    expect(OPFS.splitPath('agents//abc///memories')).toEqual([
      'agents',
      'abc',
      'memories',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(OPFS.splitPath('')).toEqual([]);
  });

  it('returns empty array for just slashes', () => {
    expect(OPFS.splitPath('///')).toEqual([]);
  });

  it('handles single segment', () => {
    expect(OPFS.splitPath('file.txt')).toEqual(['file.txt']);
  });
});

// ── OPFS method tests with mocked File System Access API ──

describe('OPFS', () => {
  let opfs: OPFS;
  let mockRoot: MockDirectoryHandle;

  // In-memory mock of the File System Access API
  class MockFileHandle {
    name: string;
    private content: string;

    constructor(name: string, content = '') {
      this.name = name;
      this.content = content;
    }

    async getFile() {
      return {
        text: async () => this.content,
      };
    }

    async createWritable() {
      const self = this;
      let buffer = '';
      return {
        write(data: string) {
          buffer += data;
        },
        close() {
          self.content = buffer;
        },
      };
    }
  }

  class MockDirectoryHandle {
    name: string;
    kind = 'directory' as const;
    private files = new Map<string, MockFileHandle>();
    private dirs = new Map<string, MockDirectoryHandle>();

    constructor(name: string) {
      this.name = name;
    }

    async getFileHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<MockFileHandle> {
      if (this.files.has(name)) {
        return this.files.get(name)!;
      }
      if (options?.create) {
        const handle = new MockFileHandle(name);
        this.files.set(name, handle);
        return handle;
      }
      throw new DOMException('File not found', 'NotFoundError');
    }

    async getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<MockDirectoryHandle> {
      if (this.dirs.has(name)) {
        return this.dirs.get(name)!;
      }
      if (options?.create) {
        const handle = new MockDirectoryHandle(name);
        this.dirs.set(name, handle);
        return handle;
      }
      throw new DOMException('Directory not found', 'NotFoundError');
    }

    async removeEntry(name: string, _options?: { recursive?: boolean }) {
      if (!this.files.has(name) && !this.dirs.has(name)) {
        throw new DOMException('Not found', 'NotFoundError');
      }
      this.files.delete(name);
      this.dirs.delete(name);
    }

    entries(): AsyncIterable<[string, MockFileHandle | MockDirectoryHandle]> {
      const all = new Map<string, MockFileHandle | MockDirectoryHandle>();
      for (const [k, v] of this.files) all.set(k, v);
      for (const [k, v] of this.dirs) all.set(k, v);
      const iter = all.entries();

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              const result = iter.next();
              return result;
            },
          };
        },
      };
    }
  }

  beforeEach(() => {
    mockRoot = new MockDirectoryHandle('root');
    // Mock navigator.storage.getDirectory
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
      },
    });
    opfs = new OPFS();
  });

  it('writeFile creates parent directories and writes content', async () => {
    await opfs.writeFile('agents/a1/memo.txt', 'hello world');
    const content = await opfs.readFile('agents/a1/memo.txt');
    expect(content).toBe('hello world');
  });

  it('writeFile overwrites existing content', async () => {
    await opfs.writeFile('file.txt', 'first');
    await opfs.writeFile('file.txt', 'second');
    const content = await opfs.readFile('file.txt');
    expect(content).toBe('second');
  });

  it('readFile throws on nonexistent file', async () => {
    await expect(opfs.readFile('nope.txt')).rejects.toThrow();
  });

  it('appendFile appends to existing content', async () => {
    await opfs.writeFile('log.jsonl', '{"a":1}\n');
    await opfs.appendFile('log.jsonl', '{"b":2}\n');
    const content = await opfs.readFile('log.jsonl');
    expect(content).toBe('{"a":1}\n{"b":2}\n');
  });

  it('appendFile creates file if it does not exist', async () => {
    await opfs.appendFile('new.jsonl', '{"x":1}\n');
    const content = await opfs.readFile('new.jsonl');
    expect(content).toBe('{"x":1}\n');
  });

  it('readLines returns all non-empty lines', async () => {
    await opfs.writeFile('lines.txt', 'a\nb\nc\n');
    const lines = await opfs.readLines('lines.txt');
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('readLines with lastN returns tail', async () => {
    await opfs.writeFile('lines.txt', 'a\nb\nc\nd\ne\n');
    const lines = await opfs.readLines('lines.txt', 2);
    expect(lines).toEqual(['d', 'e']);
  });

  it('mkdir creates nested directories', async () => {
    await opfs.mkdir('a/b/c');
    // Should not throw when creating a file inside
    await opfs.writeFile('a/b/c/file.txt', 'test');
    const content = await opfs.readFile('a/b/c/file.txt');
    expect(content).toBe('test');
  });

  it('exists returns false for nonexistent path', async () => {
    expect(await opfs.exists('nope')).toBe(false);
  });

  it('exists returns true for existing file', async () => {
    await opfs.writeFile('exists.txt', 'yes');
    expect(await opfs.exists('exists.txt')).toBe(true);
  });

  it('exists returns true for existing directory', async () => {
    await opfs.mkdir('mydir');
    expect(await opfs.exists('mydir')).toBe(true);
  });

  it('delete removes a file', async () => {
    await opfs.writeFile('deleteme.txt', 'bye');
    expect(await opfs.exists('deleteme.txt')).toBe(true);
    await opfs.delete('deleteme.txt');
    expect(await opfs.exists('deleteme.txt')).toBe(false);
  });

  it('delete throws on nonexistent path', async () => {
    await expect(opfs.delete('nope.txt')).rejects.toThrow();
  });

  it('listDir returns sorted entries', async () => {
    await opfs.writeFile('dir/b.txt', 'b');
    await opfs.writeFile('dir/a.txt', 'a');
    await opfs.mkdir('dir/sub');
    const entries = await opfs.listDir('dir');
    expect(entries).toEqual(['a.txt', 'b.txt', 'sub']);
  });
});
