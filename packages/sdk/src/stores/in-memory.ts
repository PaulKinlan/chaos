import type { AgentMeta, Hook, UsageRecord, UsageQueryOptions, Conversation, FileEntry } from '../types.js';
import type { SettingsStore, MemoryStore, ConversationStore, HookStore, UsageStore, AgentStore } from './index.js';

// ── InMemorySettingsStore ──

export class InMemorySettingsStore implements SettingsStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async getMultiple<T>(keys: string[]): Promise<Record<string, T>> {
    const result: Record<string, T> = {};
    for (const key of keys) {
      const val = this.data.get(key);
      if (val !== undefined) {
        result[key] = val as T;
      }
    }
    return result;
  }
}

// ── InMemoryMemoryStore ──

interface FileNode {
  type: 'file' | 'directory';
  content?: string;
  children?: Map<string, FileNode>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private roots = new Map<string, FileNode>();

  private getRoot(agentId: string): FileNode {
    let root = this.roots.get(agentId);
    if (!root) {
      root = { type: 'directory', children: new Map() };
      this.roots.set(agentId, root);
    }
    return root;
  }

  private parsePath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }

  private navigate(root: FileNode, segments: string[], createDirs: boolean): FileNode | undefined {
    let current = root;
    for (const seg of segments) {
      if (!current.children) {
        if (!createDirs) return undefined;
        current.children = new Map();
      }
      let child = current.children.get(seg);
      if (!child) {
        if (!createDirs) return undefined;
        child = { type: 'directory', children: new Map() };
        current.children.set(seg, child);
      }
      current = child;
    }
    return current;
  }

  async read(agentId: string, path: string): Promise<string> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const node = this.navigate(root, segments, false);
    if (!node || node.type !== 'file' || node.content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return node.content;
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const parentSegs = segments.slice(0, -1);
    const fileName = segments[segments.length - 1];
    const parent = this.navigate(root, parentSegs, true)!;
    if (!parent.children) parent.children = new Map();
    parent.children.set(fileName, { type: 'file', content });
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const node = this.navigate(root, segments, false);
    if (!node || node.type !== 'file') {
      // If file doesn't exist, create it
      await this.write(agentId, path, content);
      return;
    }
    node.content = (node.content ?? '') + content;
  }

  async delete(agentId: string, path: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    if (segments.length === 0) return;
    const parentSegs = segments.slice(0, -1);
    const name = segments[segments.length - 1];
    const parent = this.navigate(root, parentSegs, false);
    if (parent?.children) {
      parent.children.delete(name);
    }
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const root = this.getRoot(agentId);
    const segments = path ? this.parsePath(path) : [];
    const node = segments.length > 0 ? this.navigate(root, segments, false) : root;
    if (!node || !node.children) return [];
    const entries: FileEntry[] = [];
    for (const [name, child] of node.children) {
      entries.push({ name, type: child.type });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(agentId: string, path: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    this.navigate(root, segments, true);
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const node = this.navigate(root, segments, false);
    return node !== undefined;
  }

  async search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>> {
    const results: Array<{ path: string; line: string }> = [];
    const root = this.getRoot(agentId);
    const segments = path ? this.parsePath(path) : [];
    const startNode = segments.length > 0 ? this.navigate(root, segments, false) : root;
    if (!startNode) return results;

    const prefix = path ? path.replace(/\/$/, '') + '/' : '';
    this.searchNode(startNode, prefix, pattern, results);
    return results;
  }

  private searchNode(
    node: FileNode,
    currentPath: string,
    pattern: string,
    results: Array<{ path: string; line: string }>,
  ): void {
    if (node.type === 'file' && node.content) {
      const lines = node.content.split('\n');
      for (const line of lines) {
        if (line.includes(pattern)) {
          results.push({ path: currentPath.replace(/\/$/, ''), line });
        }
      }
    }
    if (node.children) {
      for (const [name, child] of node.children) {
        this.searchNode(child, currentPath + name + (child.type === 'directory' ? '/' : ''), pattern, results);
      }
    }
  }
}

// ── InMemoryConversationStore ──

export class InMemoryConversationStore implements ConversationStore {
  private data = new Map<string, Map<string, Conversation>>();

  private getAgentMap(agentId: string): Map<string, Conversation> {
    let map = this.data.get(agentId);
    if (!map) {
      map = new Map();
      this.data.set(agentId, map);
    }
    return map;
  }

  async get(agentId: string, conversationId: string): Promise<Conversation | undefined> {
    return this.getAgentMap(agentId).get(conversationId);
  }

  async list(agentId: string): Promise<Array<{ id: string; timestamp: string }>> {
    const map = this.getAgentMap(agentId);
    return Array.from(map.values()).map(c => ({ id: c.id, timestamp: c.timestamp }));
  }

  async save(agentId: string, conversation: Conversation): Promise<void> {
    this.getAgentMap(agentId).set(conversation.id, conversation);
  }

  async delete(agentId: string, conversationId: string): Promise<void> {
    this.getAgentMap(agentId).delete(conversationId);
  }
}

// ── InMemoryHookStore ──

export class InMemoryHookStore implements HookStore {
  private hooks = new Map<string, Hook>();

  async list(agentId?: string): Promise<Hook[]> {
    const all = Array.from(this.hooks.values());
    if (agentId) return all.filter(h => h.agentId === agentId);
    return all;
  }

  async get(hookId: string): Promise<Hook | undefined> {
    return this.hooks.get(hookId);
  }

  async add(hook: Hook): Promise<void> {
    this.hooks.set(hook.id, hook);
  }

  async update(hookId: string, updates: Partial<Hook>): Promise<void> {
    const existing = this.hooks.get(hookId);
    if (!existing) throw new Error(`Hook not found: ${hookId}`);
    this.hooks.set(hookId, { ...existing, ...updates });
  }

  async remove(hookId: string): Promise<void> {
    this.hooks.delete(hookId);
  }
}

// ── InMemoryUsageStore ──

export class InMemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];

  async record(entry: UsageRecord): Promise<void> {
    this.records.push(entry);
  }

  async query(options?: UsageQueryOptions): Promise<UsageRecord[]> {
    let results = [...this.records];
    if (options?.agentId) {
      results = results.filter(r => r.agentId === options.agentId);
    }
    if (options?.provider) {
      results = results.filter(r => r.provider === options.provider);
    }
    if (options?.since) {
      results = results.filter(r => r.timestamp >= options.since!);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

// ── InMemoryAgentStore ──

export class InMemoryAgentStore implements AgentStore {
  private agents = new Map<string, AgentMeta>();

  async list(): Promise<AgentMeta[]> {
    return Array.from(this.agents.values());
  }

  async get(agentId: string): Promise<AgentMeta | undefined> {
    return this.agents.get(agentId);
  }

  async add(agent: AgentMeta): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async update(agentId: string, updates: Partial<AgentMeta>): Promise<void> {
    const existing = this.agents.get(agentId);
    if (!existing) throw new Error(`Agent not found: ${agentId}`);
    this.agents.set(agentId, { ...existing, ...updates });
  }

  async remove(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }
}
