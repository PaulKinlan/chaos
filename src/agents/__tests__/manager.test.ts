/**
 * Tests for the Agent Manager.
 *
 * Mocks chrome.storage and chrome.bookmarks APIs since we're
 * running outside a Chrome extension context.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAgent, listAgents, getAgent, deleteAgent, updateAgentMeta } from '../manager.js';

// ── Chrome API mocks ──

const mockStorage: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    sync: {
      get: vi.fn(async (key: string) => {
        return { [key]: mockStorage[key] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
    local: {
      get: vi.fn(async (key: string) => {
        return { [key]: mockStorage[key] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
  bookmarks: {
    create: vi.fn(async (opts: { title: string }) => ({
      id: `bookmark-${Date.now()}`,
      title: opts.title,
    })),
    removeTree: vi.fn(async () => {}),
  },
};

// ── OPFS mock ──

const mockFiles: Record<string, string> = {};
const mockDirs = new Set<string>();

vi.mock('../../storage/opfs.js', () => ({
  opfs: {
    mkdir: vi.fn(async (path: string) => {
      mockDirs.add(path);
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      mockFiles[path] = content;
    }),
    readFile: vi.fn(async (path: string) => {
      if (path in mockFiles) return mockFiles[path];
      throw new Error(`File not found: ${path}`);
    }),
    delete: vi.fn(async (path: string) => {
      // Remove files and dirs that start with this path
      for (const key of Object.keys(mockFiles)) {
        if (key.startsWith(path)) delete mockFiles[key];
      }
      for (const dir of mockDirs) {
        if (dir.startsWith(path)) mockDirs.delete(dir);
      }
    }),
    exists: vi.fn(async (path: string) => {
      return path in mockFiles || mockDirs.has(path);
    }),
  },
  OPFS: vi.fn(),
}));

// Install chrome mock
beforeEach(() => {
  // Clear state
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  mockDirs.clear();

  // Reset mocks
  vi.clearAllMocks();

  // Install global chrome
  (globalThis as any).chrome = chromeMock;
});

describe('Agent Manager', () => {
  describe('createAgent', () => {
    it('creates an agent with correct metadata', async () => {
      const agent = await createAgent('TestBot', 'neutral');

      expect(agent.name).toBe('TestBot');
      expect(agent.role).toBe('neutral');
      expect(agent.visibility).toBe('private');
      expect(agent.id).toMatch(/^agent-/);
      expect(agent.createdAt).toBeTruthy();
      expect(agent.bookmarkFolderId).toBeTruthy();
    });

    it('creates OPFS directory structure', async () => {
      const agent = await createAgent('TestBot', 'coder');

      expect(mockDirs.has(`agents/${agent.id}`)).toBe(true);
      expect(mockDirs.has(`agents/${agent.id}/memories`)).toBe(true);
      expect(mockDirs.has(`agents/${agent.id}/people`)).toBe(true);
      expect(mockDirs.has(`agents/${agent.id}/ideas`)).toBe(true);
      expect(mockDirs.has(`agents/${agent.id}/bookmarks`)).toBe(true);
      expect(mockDirs.has(`agents/${agent.id}/conversations`)).toBe(true);
    });

    it('writes CLAUDE.md from the role template', async () => {
      const agent = await createAgent('CodeBot', 'coder');

      const claudeMd = mockFiles[`agents/${agent.id}/CLAUDE.md`];
      expect(claudeMd).toContain('CodeBot');
      expect(claudeMd).toContain('coding');
    });

    it('writes initial TODO.md', async () => {
      const agent = await createAgent('TestBot', 'neutral');

      const todo = mockFiles[`agents/${agent.id}/TODO.md`];
      expect(todo).toContain('TestBot');
    });

    it('registers agent in Chrome storage', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      const agents = mockStorage['chaos:agents'] as any[];

      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe(agent.id);
    });

    it('creates a Chrome bookmark folder', async () => {
      await createAgent('TestBot', 'neutral');

      expect(chromeMock.bookmarks.create).toHaveBeenCalledWith({
        title: 'CHAOS: TestBot',
      });
    });

    it('falls back to neutral template for unknown roles', async () => {
      const agent = await createAgent('TestBot', 'nonexistent-role');

      const claudeMd = mockFiles[`agents/${agent.id}/CLAUDE.md`];
      expect(claudeMd).toContain('TestBot');
      expect(claudeMd).toContain('general-purpose');
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents exist', async () => {
      const agents = await listAgents();
      expect(agents).toEqual([]);
    });

    it('returns all created agents', async () => {
      await createAgent('Agent1', 'neutral');
      await createAgent('Agent2', 'coder');

      const agents = await listAgents();
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('Agent1');
      expect(agents[1].name).toBe('Agent2');
    });
  });

  describe('getAgent', () => {
    it('returns metadata and CLAUDE.md', async () => {
      const created = await createAgent('TestBot', 'researcher');
      const result = await getAgent(created.id);

      expect(result.meta.id).toBe(created.id);
      expect(result.meta.name).toBe('TestBot');
      expect(result.claudeMd).toContain('TestBot');
      expect(result.claudeMd).toContain('research');
    });

    it('throws for non-existent agent', async () => {
      await expect(getAgent('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  describe('deleteAgent', () => {
    it('removes agent from Chrome storage', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      await deleteAgent(agent.id);

      const agents = await listAgents();
      expect(agents).toHaveLength(0);
    });

    it('removes OPFS directory', async () => {
      const { opfs: mockOpfs } = await import('../../storage/opfs.js');
      const agent = await createAgent('TestBot', 'neutral');
      await deleteAgent(agent.id);

      expect(mockOpfs.delete).toHaveBeenCalledWith(`agents/${agent.id}`);
    });

    it('removes Chrome bookmark folder', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      const folderId = agent.bookmarkFolderId;
      await deleteAgent(agent.id);

      expect(chromeMock.bookmarks.removeTree).toHaveBeenCalledWith(folderId);
    });

    it('handles deletion of non-existent agent gracefully', async () => {
      await expect(deleteAgent('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('updateAgentMeta', () => {
    it('updates agent metadata', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      await updateAgentMeta(agent.id, { name: 'UpdatedBot', visibility: 'visible' });

      const agents = await listAgents();
      expect(agents[0].name).toBe('UpdatedBot');
      expect(agents[0].visibility).toBe('visible');
    });

    it('preserves unchanged fields', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      await updateAgentMeta(agent.id, { visibility: 'open' });

      const agents = await listAgents();
      expect(agents[0].name).toBe('TestBot');
      expect(agents[0].role).toBe('neutral');
      expect(agents[0].visibility).toBe('open');
    });

    it('throws for non-existent agent', async () => {
      await expect(
        updateAgentMeta('nonexistent', { name: 'Test' }),
      ).rejects.toThrow('Agent not found');
    });

    it('does not allow changing the ID', async () => {
      const agent = await createAgent('TestBot', 'neutral');
      await updateAgentMeta(agent.id, { id: 'new-id' } as any);

      const agents = await listAgents();
      expect(agents[0].id).toBe(agent.id);
    });
  });
});
