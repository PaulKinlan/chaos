import type {
  AgentMeta,
  Hook,
  UsageRecord,
  UsageQueryOptions,
  Conversation,
} from '@chaos/sdk';
import type {
  ConversationStore,
  HookStore,
  UsageStore,
  AgentStore,
} from '@chaos/sdk/stores';

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
    return Array.from(map.values()).map((c) => ({ id: c.id, timestamp: c.timestamp }));
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
    if (agentId) return all.filter((h) => h.agentId === agentId);
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
      results = results.filter((r) => r.agentId === options.agentId);
    }
    if (options?.provider) {
      results = results.filter((r) => r.provider === options.provider);
    }
    if (options?.since) {
      const since = options.since;
      results = results.filter((r) => r.timestamp >= since);
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
