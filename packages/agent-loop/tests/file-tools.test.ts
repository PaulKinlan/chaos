import { describe, it, expect, beforeEach } from 'vitest';
import { createFileTools } from '../src/tools/file-tools.js';
import { InMemoryMemoryStore } from '../src/stores/in-memory.js';

describe('createFileTools', () => {
  let store: InMemoryMemoryStore;
  const agentId = 'test-agent';

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  function getTools() {
    return createFileTools(store, agentId);
  }

  async function execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tools = getTools();
    const tool = tools[toolName];
    if (!tool || !tool.execute) throw new Error(`Tool ${toolName} not found or has no execute`);
    return (tool.execute as Function)(args, {}) as Promise<string>;
  }

  it('creates all expected tools', () => {
    const tools = getTools();
    expect(Object.keys(tools).sort()).toEqual([
      'delete_file',
      'find_files',
      'grep_file',
      'list_directory',
      'read_file',
      'write_file',
    ]);
  });

  it('write_file and read_file round-trip', async () => {
    const writeResult = await execute('write_file', { path: 'test.md', content: 'hello world' });
    expect(writeResult).toContain('Successfully wrote');

    const readResult = await execute('read_file', { path: 'test.md' });
    expect(readResult).toBe('hello world');
  });

  it('read_file returns error for missing file', async () => {
    const result = await execute('read_file', { path: 'nonexistent.md' });
    expect(result).toContain('Error:');
  });

  it('list_directory lists files', async () => {
    await store.write(agentId, 'dir/a.md', 'aaa');
    await store.write(agentId, 'dir/b.md', 'bbb');

    const result = await execute('list_directory', { path: 'dir' });
    expect(result).toContain('a.md');
    expect(result).toContain('b.md');
  });

  it('list_directory returns empty message for empty dir', async () => {
    const result = await execute('list_directory', { path: 'empty' });
    expect(result).toContain('empty');
  });

  it('delete_file removes a file', async () => {
    await store.write(agentId, 'delete-me.md', 'data');
    const result = await execute('delete_file', { path: 'delete-me.md' });
    expect(result).toContain('Successfully deleted');

    const readResult = await execute('read_file', { path: 'delete-me.md' });
    expect(readResult).toContain('Error:');
  });

  it('grep_file finds matching content', async () => {
    await store.write(agentId, 'notes.md', 'hello world\ngoodbye moon');
    await store.write(agentId, 'other.md', 'no match');

    const result = await execute('grep_file', { pattern: 'hello' });
    expect(result).toContain('notes.md');
    expect(result).toContain('hello world');
  });

  it('grep_file returns no-match message', async () => {
    await store.write(agentId, 'notes.md', 'nothing here');
    const result = await execute('grep_file', { pattern: 'xyz123' });
    expect(result).toContain('No matches');
  });

  it('find_files lists recursively', async () => {
    await store.write(agentId, 'a.md', 'top');
    await store.write(agentId, 'sub/b.md', 'nested');

    const result = await execute('find_files', {});
    expect(result).toContain('a.md');
    expect(result).toContain('sub');
    expect(result).toContain('b.md');
  });
});
