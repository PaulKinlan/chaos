/**
 * Integration Test: Storage Consistency
 *
 * Tests storage layer integration: OPFS read/write round-trips,
 * JSONL append/readLines, Chrome storage round-trips, nested
 * directory creation, file deletion, and concurrent operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupIntegrationMocks, resetIntegrationState } from './setup.js';

// Install mocks before imports
setupIntegrationMocks();

import { opfs } from '../../storage/opfs.js';
import { getAgentList, setAgentList, getSettings, setSettings, getApiKeys, setApiKeys } from '../../storage/chrome-storage.js';
import type { AgentMeta, Settings } from '../../storage/types.js';

beforeEach(() => {
  resetIntegrationState();
  (opfs as any).rootPromise = null;
});

describe('Storage Consistency', () => {
  describe('OPFS read/write round-trip', () => {
    it('write a file and read it back with matching content', async () => {
      const content = '# Test Document\n\nThis is a test with special chars: @#$% émojis 🎉';
      await opfs.writeFile('test/document.md', content);
      const result = await opfs.readFile('test/document.md');
      expect(result).toBe(content);
    });

    it('overwrite a file and read back new content', async () => {
      await opfs.writeFile('data.txt', 'version 1');
      await opfs.writeFile('data.txt', 'version 2');
      const result = await opfs.readFile('data.txt');
      expect(result).toBe('version 2');
    });

    it('write empty string and read it back', async () => {
      await opfs.writeFile('empty.txt', '');
      const result = await opfs.readFile('empty.txt');
      expect(result).toBe('');
    });

    it('write large content and read it back', async () => {
      const largeContent = 'x'.repeat(100000);
      await opfs.writeFile('large.txt', largeContent);
      const result = await opfs.readFile('large.txt');
      expect(result).toBe(largeContent);
      expect(result.length).toBe(100000);
    });
  });

  describe('JSONL append and readLines', () => {
    it('append multiple lines and readLines with lastN returns correct tail', async () => {
      for (let i = 1; i <= 10; i++) {
        await opfs.appendFile('log.jsonl', JSON.stringify({ n: i }) + '\n');
      }

      const lastThree = await opfs.readLines('log.jsonl', 3);
      expect(lastThree).toHaveLength(3);
      expect(JSON.parse(lastThree[0])).toEqual({ n: 8 });
      expect(JSON.parse(lastThree[1])).toEqual({ n: 9 });
      expect(JSON.parse(lastThree[2])).toEqual({ n: 10 });
    });

    it('readLines without lastN returns all lines', async () => {
      for (let i = 1; i <= 5; i++) {
        await opfs.appendFile('all.jsonl', `line${i}\n`);
      }

      const lines = await opfs.readLines('all.jsonl');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('line1');
      expect(lines[4]).toBe('line5');
    });

    it('readLines filters out empty lines', async () => {
      await opfs.writeFile('sparse.txt', 'a\n\nb\n\n\nc\n');
      const lines = await opfs.readLines('sparse.txt');
      expect(lines).toEqual(['a', 'b', 'c']);
    });

    it('append to nonexistent file creates it', async () => {
      await opfs.appendFile('new.jsonl', '{"first":true}\n');
      const content = await opfs.readFile('new.jsonl');
      expect(content).toBe('{"first":true}\n');
    });
  });

  describe('Chrome storage round-trip', () => {
    it('set agent list and get it back', async () => {
      const agents: AgentMeta[] = [
        {
          id: 'agent-1',
          name: 'TestAgent',
          role: 'researcher',
          visibility: 'visible',
          createdAt: '2026-04-01T10:00:00Z',
        },
        {
          id: 'agent-2',
          name: 'TestAgent2',
          role: 'writer',
          visibility: 'private',
          createdAt: '2026-04-01T11:00:00Z',
        },
      ];

      await setAgentList(agents);
      const result = await getAgentList();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('agent-1');
      expect(result[0].name).toBe('TestAgent');
      expect(result[1].id).toBe('agent-2');
      expect(result[1].visibility).toBe('private');
    });

    it('empty agent list returns empty array', async () => {
      const result = await getAgentList();
      expect(result).toEqual([]);
    });

    it('settings round-trip with defaults', async () => {
      // Without setting, should return defaults
      const defaults = await getSettings();
      expect(defaults.activeProvider).toBe('anthropic');
      expect(defaults.theme).toBe('system');

      // Set custom settings
      const custom: Settings = {
        activeProvider: 'openai',
        theme: 'dark',
      };
      await setSettings(custom);

      const result = await getSettings();
      expect(result.activeProvider).toBe('openai');
      expect(result.theme).toBe('dark');
    });

    it('API keys round-trip (local storage)', async () => {
      const keys = {
        anthropic: 'sk-ant-test',
        openai: 'sk-test',
      };
      await setApiKeys(keys);

      const result = await getApiKeys();
      expect(result.anthropic).toBe('sk-ant-test');
      expect(result.openai).toBe('sk-test');
    });

    it('API keys default to empty object', async () => {
      const result = await getApiKeys();
      expect(result).toEqual({});
    });
  });

  describe('OPFS directory operations', () => {
    it('mkdir creates nested directories', async () => {
      await opfs.mkdir('deep/nested/path/here');
      // Should be able to write a file inside
      await opfs.writeFile('deep/nested/path/here/file.txt', 'deep content');
      const content = await opfs.readFile('deep/nested/path/here/file.txt');
      expect(content).toBe('deep content');
    });

    it('mkdir is idempotent', async () => {
      await opfs.mkdir('mydir');
      await opfs.mkdir('mydir'); // should not throw
      await opfs.writeFile('mydir/file.txt', 'ok');
      expect(await opfs.readFile('mydir/file.txt')).toBe('ok');
    });

    it('delete removes files', async () => {
      await opfs.writeFile('removeme.txt', 'gone soon');
      expect(await opfs.exists('removeme.txt')).toBe(true);
      await opfs.delete('removeme.txt');
      expect(await opfs.exists('removeme.txt')).toBe(false);
    });

    it('delete removes directories', async () => {
      await opfs.mkdir('rmdir');
      await opfs.writeFile('rmdir/inner.txt', 'content');
      expect(await opfs.exists('rmdir')).toBe(true);
      await opfs.delete('rmdir');
      expect(await opfs.exists('rmdir')).toBe(false);
    });

    it('listDir returns sorted entries', async () => {
      await opfs.writeFile('listing/zebra.txt', 'z');
      await opfs.writeFile('listing/apple.txt', 'a');
      await opfs.mkdir('listing/subdir');

      const entries = await opfs.listDir('listing');
      expect(entries).toEqual(['apple.txt', 'subdir', 'zebra.txt']);
    });

    it('exists returns true for root', async () => {
      expect(await opfs.exists('')).toBe(true);
    });
  });

  describe('Concurrent reads and writes', () => {
    it('concurrent writes to different files do not interfere', async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(opfs.writeFile(`concurrent/file-${i}.txt`, `content-${i}`));
      }
      await Promise.all(promises);

      // Verify all files have correct content
      for (let i = 0; i < 20; i++) {
        const content = await opfs.readFile(`concurrent/file-${i}.txt`);
        expect(content).toBe(`content-${i}`);
      }
    });

    it('concurrent reads of the same file return consistent data', async () => {
      await opfs.writeFile('shared-read.txt', 'stable content');

      const readPromises = [];
      for (let i = 0; i < 10; i++) {
        readPromises.push(opfs.readFile('shared-read.txt'));
      }
      const results = await Promise.all(readPromises);

      // All reads should return the same content
      for (const result of results) {
        expect(result).toBe('stable content');
      }
    });
  });
});
