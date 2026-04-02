/**
 * Tests for the Tool Permission System.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chrome storage mock ──

const mockStorage: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  vi.clearAllMocks();

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          return { [key]: mockStorage[key] };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            mockStorage[k] = v;
          }
        }),
      },
    },
  };
});

// ── Import after mocks ──

import {
  getPermission,
  setPermission,
  checkPermission,
  getAllPermissions,
  DEFAULT_PERMISSIONS,
  type PermissionLevel,
} from '../permissions.js';

describe('Tool Permissions', () => {
  describe('DEFAULT_PERMISSIONS', () => {
    it('has safe tools set to always', () => {
      expect(DEFAULT_PERMISSIONS.read_file).toBe('always');
      expect(DEFAULT_PERMISSIONS.list_directory).toBe('always');
      expect(DEFAULT_PERMISSIONS.tab_list).toBe('always');
      expect(DEFAULT_PERMISSIONS.bookmark_search).toBe('always');
      expect(DEFAULT_PERMISSIONS.history_search).toBe('always');
      expect(DEFAULT_PERMISSIONS.alarm_list).toBe('always');
      expect(DEFAULT_PERMISSIONS.message_read).toBe('always');
      expect(DEFAULT_PERMISSIONS.task_list).toBe('always');
      expect(DEFAULT_PERMISSIONS.artifact_list).toBe('always');
      expect(DEFAULT_PERMISSIONS.artifact_read).toBe('always');
      expect(DEFAULT_PERMISSIONS.agent_discover).toBe('always');
    });

    it('has destructive tools set to ask', () => {
      expect(DEFAULT_PERMISSIONS.write_file).toBe('ask');
      expect(DEFAULT_PERMISSIONS.edit_file).toBe('ask');
      expect(DEFAULT_PERMISSIONS.tab_open).toBe('ask');
      expect(DEFAULT_PERMISSIONS.tab_close).toBe('ask');
      expect(DEFAULT_PERMISSIONS.bookmark_add).toBe('ask');
      expect(DEFAULT_PERMISSIONS.alarm_set).toBe('ask');
      expect(DEFAULT_PERMISSIONS.message_send).toBe('ask');
      expect(DEFAULT_PERMISSIONS.task_create).toBe('ask');
      expect(DEFAULT_PERMISSIONS.artifact_publish).toBe('ask');
      expect(DEFAULT_PERMISSIONS.fetch_page).toBe('ask');
    });
  });

  describe('getPermission', () => {
    it('returns default permission when nothing is stored', async () => {
      const level = await getPermission('read_file');
      expect(level).toBe('always');
    });

    it('returns default for destructive tools', async () => {
      const level = await getPermission('write_file');
      expect(level).toBe('ask');
    });

    it('returns ask for unknown tools', async () => {
      const level = await getPermission('unknown_tool');
      expect(level).toBe('ask');
    });

    it('returns stored permission when set', async () => {
      mockStorage['chaos:toolPermissions'] = { read_file: 'never' };
      const level = await getPermission('read_file');
      expect(level).toBe('never');
    });
  });

  describe('setPermission', () => {
    it('stores the permission in chrome storage', async () => {
      await setPermission('read_file', 'never');

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const stored = mockStorage['chaos:toolPermissions'] as Record<string, string>;
      expect(stored.read_file).toBe('never');
    });

    it('preserves other permissions when setting one', async () => {
      mockStorage['chaos:toolPermissions'] = { write_file: 'always' };

      await setPermission('read_file', 'never');

      const stored = mockStorage['chaos:toolPermissions'] as Record<string, string>;
      expect(stored.write_file).toBe('always');
      expect(stored.read_file).toBe('never');
    });

    it('can change an existing permission', async () => {
      await setPermission('tab_open', 'never');
      await setPermission('tab_open', 'always');

      const stored = mockStorage['chaos:toolPermissions'] as Record<string, string>;
      expect(stored.tab_open).toBe('always');
    });
  });

  describe('checkPermission', () => {
    it('returns true for always-permitted tools', async () => {
      const allowed = await checkPermission('read_file');
      expect(allowed).toBe(true);
    });

    it('returns false for never-permitted tools', async () => {
      mockStorage['chaos:toolPermissions'] = { read_file: 'never' };
      const allowed = await checkPermission('read_file');
      expect(allowed).toBe(false);
    });

    it('returns true for ask-permitted tools (defaults to allow until UI is wired)', async () => {
      const allowed = await checkPermission('write_file');
      expect(allowed).toBe(true);
    });

    it('returns false when a tool is explicitly set to never', async () => {
      await setPermission('tab_open', 'never');
      const allowed = await checkPermission('tab_open');
      expect(allowed).toBe(false);
    });

    it('returns true when a destructive tool is overridden to always', async () => {
      await setPermission('write_file', 'always');
      const allowed = await checkPermission('write_file');
      expect(allowed).toBe(true);
    });
  });

  describe('getAllPermissions', () => {
    it('returns defaults when nothing is stored', async () => {
      const perms = await getAllPermissions();
      expect(perms.read_file).toBe('always');
      expect(perms.write_file).toBe('ask');
    });

    it('merges stored permissions with defaults', async () => {
      mockStorage['chaos:toolPermissions'] = { read_file: 'never' };
      const perms = await getAllPermissions();
      expect(perms.read_file).toBe('never');
      expect(perms.write_file).toBe('ask');
      expect(perms.tab_list).toBe('always');
    });

    it('stored values override defaults', async () => {
      mockStorage['chaos:toolPermissions'] = { write_file: 'always', tab_list: 'never' };
      const perms = await getAllPermissions();
      expect(perms.write_file).toBe('always');
      expect(perms.tab_list).toBe('never');
    });
  });
});
