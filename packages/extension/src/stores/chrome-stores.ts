/**
 * Chrome store implementations for @chaos/sdk.
 *
 * These wrap the existing chrome-storage.ts and opfs.ts modules
 * to implement the SDK store interfaces. The underlying storage
 * functions are preserved — these are adapters, not replacements.
 */

import type {
  AgentStore,
  SettingsStore,
  HookStore,
  UsageStore,
  MemoryStore,
  ConversationStore,
} from '@chaos/sdk/stores';

import type {
  AgentMeta,
  Hook,
  UsageRecord,
  UsageQueryOptions,
  Conversation,
  FileEntry,
} from '@chaos/sdk';

import {
  getAgentList,
  setAgentList,
  getHooks,
  addHook as chromeAddHook,
  updateHook as chromeUpdateHook,
  removeHook as chromeRemoveHook,
} from '../storage/chrome-storage.js';

import { opfs } from '../storage/opfs.js';

import {
  getUsageRecords,
  getUsage,
  clearUsage,
} from '../agents/usage.js';

import {
  getConversation as idbGetConversation,
  setConversation as idbSetConversation,
  listConversations as idbListConversations,
  deleteConversation as idbDeleteConversation,
} from '../storage/idb.js';

// ── ChromeAgentStore ──

export class ChromeAgentStore implements AgentStore {
  async list(): Promise<AgentMeta[]> {
    return getAgentList() as Promise<AgentMeta[]>;
  }

  async get(agentId: string): Promise<AgentMeta | undefined> {
    const agents = await getAgentList();
    return agents.find((a) => a.id === agentId) as AgentMeta | undefined;
  }

  async add(agent: AgentMeta): Promise<void> {
    const agents = await getAgentList();
    agents.push(agent as any);
    await setAgentList(agents);
  }

  async update(agentId: string, updates: Partial<AgentMeta>): Promise<void> {
    const agents = await getAgentList();
    const idx = agents.findIndex((a) => a.id === agentId);
    if (idx === -1) throw new Error(`Agent not found: ${agentId}`);
    Object.assign(agents[idx], updates);
    await setAgentList(agents);
  }

  async remove(agentId: string): Promise<void> {
    const agents = await getAgentList();
    await setAgentList(agents.filter((a) => a.id !== agentId));
  }
}

// ── ChromeSettingsStore ──

export class ChromeSettingsStore implements SettingsStore {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }

  async getMultiple<T>(keys: string[]): Promise<Record<string, T>> {
    const result = await chrome.storage.local.get(keys);
    const out: Record<string, T> = {};
    for (const key of keys) {
      if (result[key] !== undefined) {
        out[key] = result[key] as T;
      }
    }
    return out;
  }
}

// ── ChromeHookStore ──

export class ChromeHookStore implements HookStore {
  async list(agentId?: string): Promise<Hook[]> {
    const hooks = await getHooks();
    if (agentId) {
      return hooks.filter((h) => h.agentId === agentId) as Hook[];
    }
    return hooks as Hook[];
  }

  async get(hookId: string): Promise<Hook | undefined> {
    const hooks = await getHooks();
    return hooks.find((h) => h.id === hookId) as Hook | undefined;
  }

  async add(hook: Hook): Promise<void> {
    await chromeAddHook(hook as any);
  }

  async update(hookId: string, updates: Partial<Hook>): Promise<void> {
    await chromeUpdateHook(hookId, updates as any);
  }

  async remove(hookId: string): Promise<void> {
    await chromeRemoveHook(hookId);
  }
}

// ── ChromeUsageStore ──

const USAGE_STORAGE_KEY = 'chaos:usage';
const USAGE_MAX_RECORDS = 5000;
const USAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class ChromeUsageStore implements UsageStore {
  async record(entry: UsageRecord): Promise<void> {
    const records = await getUsageRecords();
    records.push(entry as any);

    // Trim: remove expired + cap at MAX_RECORDS
    const cutoff = Date.now() - USAGE_RETENTION_MS;
    const trimmed = records
      .filter((r) => new Date(r.timestamp).getTime() > cutoff)
      .slice(-USAGE_MAX_RECORDS);

    await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: trimmed });
  }

  async query(options?: UsageQueryOptions): Promise<UsageRecord[]> {
    const records = await getUsage(options as any);
    return records as UsageRecord[];
  }

  async clear(): Promise<void> {
    await clearUsage();
  }
}

// ── OPFSMemoryStore ──

const AGENTS_ROOT = 'agents';

export class OPFSMemoryStore implements MemoryStore {
  private agentPath(agentId: string, path: string): string {
    return `${AGENTS_ROOT}/${agentId}/${path}`;
  }

  async read(agentId: string, path: string): Promise<string> {
    return opfs.readFile(this.agentPath(agentId, path));
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    await opfs.writeFile(this.agentPath(agentId, path), content);
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    await opfs.appendFile(this.agentPath(agentId, path), content);
  }

  async delete(agentId: string, path: string): Promise<void> {
    await opfs.delete(this.agentPath(agentId, path));
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const dirPath = path
      ? this.agentPath(agentId, path)
      : `${AGENTS_ROOT}/${agentId}`;
    try {
      const entries = await opfs.listDir(dirPath);
      // listDir returns string[] of names; we need FileEntry[]
      // Probe each entry to determine if it's a file or directory
      const results: FileEntry[] = [];
      for (const name of entries) {
        const fullPath = `${dirPath}/${name}`;
        let type: 'file' | 'directory' = 'file';
        try {
          await opfs.listDir(fullPath);
          type = 'directory';
        } catch {
          type = 'file';
        }
        results.push({ name, type });
      }
      return results;
    } catch {
      return [];
    }
  }

  async mkdir(agentId: string, path: string): Promise<void> {
    await opfs.mkdir(this.agentPath(agentId, path));
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    return opfs.exists(this.agentPath(agentId, path));
  }

  async search(
    agentId: string,
    pattern: string,
    path?: string,
  ): Promise<Array<{ path: string; line: string }>> {
    const results: Array<{ path: string; line: string }> = [];
    const basePath = path
      ? this.agentPath(agentId, path)
      : `${AGENTS_ROOT}/${agentId}`;

    const searchDir = async (dirPath: string, prefix: string): Promise<void> => {
      try {
        const entries = await opfs.listDir(dirPath);
        for (const entry of entries) {
          const childPath = `${dirPath}/${entry}`;
          const displayPath = prefix ? `${prefix}/${entry}` : entry;
          try {
            const content = await opfs.readFile(childPath);
            const lines = content.split('\n');
            for (const line of lines) {
              if (line.includes(pattern)) {
                results.push({ path: displayPath, line });
              }
            }
          } catch {
            // Might be a directory
            try {
              await searchDir(childPath, displayPath);
            } catch {
              // skip
            }
          }
        }
      } catch {
        // skip
      }
    };

    await searchDir(basePath, '');
    return results;
  }
}

// ── OPFSConversationStore ──

export class OPFSConversationStore implements ConversationStore {
  async get(agentId: string, conversationId: string): Promise<Conversation | undefined> {
    const conv = await idbGetConversation(conversationId);
    if (conv && conv.agentId === agentId) {
      return conv as unknown as Conversation;
    }
    return undefined;
  }

  async list(agentId: string): Promise<Array<{ id: string; timestamp: string }>> {
    const convs = await idbListConversations(agentId);
    return convs.map((c) => ({ id: c.id, timestamp: c.timestamp }));
  }

  async save(_agentId: string, conversation: Conversation): Promise<void> {
    await idbSetConversation(conversation as any);
  }

  async delete(_agentId: string, conversationId: string): Promise<void> {
    await idbDeleteConversation(conversationId);
  }
}
