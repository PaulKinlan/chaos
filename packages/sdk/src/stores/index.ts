import type {
  AgentMeta, Hook, UsageRecord, UsageQueryOptions,
  Conversation, FileEntry,
} from '../types.js';

export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getMultiple<T>(keys: string[]): Promise<Record<string, T>>;
}

// Re-exported from @chaos/agent-loop (canonical source)
export type { MemoryStore } from '@chaos/agent-loop';

export interface ConversationStore {
  get(agentId: string, conversationId: string): Promise<Conversation | undefined>;
  list(agentId: string): Promise<Array<{ id: string; timestamp: string }>>;
  save(agentId: string, conversation: Conversation): Promise<void>;
  delete(agentId: string, conversationId: string): Promise<void>;
}

export interface HookStore {
  list(agentId?: string): Promise<Hook[]>;
  get(hookId: string): Promise<Hook | undefined>;
  add(hook: Hook): Promise<void>;
  update(hookId: string, updates: Partial<Hook>): Promise<void>;
  remove(hookId: string): Promise<void>;
}

export interface UsageStore {
  record(entry: UsageRecord): Promise<void>;
  query(options?: UsageQueryOptions): Promise<UsageRecord[]>;
  clear(): Promise<void>;
}

export interface AgentStore {
  list(): Promise<AgentMeta[]>;
  get(agentId: string): Promise<AgentMeta | undefined>;
  add(agent: AgentMeta): Promise<void>;
  update(agentId: string, updates: Partial<AgentMeta>): Promise<void>;
  remove(agentId: string): Promise<void>;
}
