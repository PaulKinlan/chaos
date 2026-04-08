import type {
  AgentMeta,
  AgentDetail,
  AgentModelConfig,
  Hook,
  ChannelConfig,
  ChannelMessage,
  ArtifactMeta,
  FileEntry,
  SkillMeta,
  SkillSearchResult,
  Task,
  UsageRecord,
  UsageSummary,
  UsageQueryOptions,
  Settings,
  ApiKeys,
  Conversation,
  ProgressUpdate,
  ChatOptions,
  AgenticOptions,
  PaginationOptions,
} from './types.js';

import type {
  SettingsStore,
  MemoryStore,
  ConversationStore,
  HookStore,
  UsageStore,
  AgentStore,
} from './stores/index.js';

import type { EngineConnection, RelayConnection } from './connections/index.js';
import type { BrowserCapabilities } from './browser/index.js';
import type { TaskScheduler, PageParser } from './services/index.js';

import type { Agent as AgentLoop } from '@chaos/agent-loop';

export interface ChaosSDKOptions {
  engine?: EngineConnection;
  relay?: RelayConnection;
  settings: SettingsStore;
  memory: MemoryStore;
  conversations: ConversationStore;
  hooks: HookStore;
  usage: UsageStore;
  agentStore: AgentStore;
  browser?: BrowserCapabilities;
  scheduler?: TaskScheduler;
  pageParser?: PageParser;
  /** Pre-configured agents — each has its own model, tools, hooks, permissions */
  agents?: AgentLoop[];
}

// ── Agents API ──

class AgentsAPI extends EventTarget {
  constructor(
    private engine: EngineConnection | undefined,
    private store: AgentStore,
    private memory: MemoryStore,
  ) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('AgentsAPI: engine connection required for this operation');
    return this.engine;
  }

  async create(name: string, role: string): Promise<AgentMeta> {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent: AgentMeta = {
      id,
      name,
      role,
      visibility: 'visible',
      createdAt: new Date().toISOString(),
    };
    await this.store.add(agent);

    // Seed memory files
    try {
      await this.memory.write(id, 'CLAUDE.md', `# ${name}\n\nYou are ${name}, an AI assistant.\n`);
      await this.memory.mkdir(id, 'memories');
      await this.memory.write(id, 'memories/user.md', '# User\n\nFacts about the user.\n');
    } catch { /* memory seeding is best-effort */ }

    this.dispatchEvent(new CustomEvent('created', { detail: agent }));
    return agent;
  }

  async list(filter?: {
    includeArchived?: boolean;
    role?: string;
    visibility?: string;
    provider?: string;
  }): Promise<AgentMeta[]> {
    let agents = await this.store.list();
    if (!filter?.includeArchived) {
      agents = agents.filter(a => a.role !== 'archived');
    }
    if (filter?.role) agents = agents.filter(a => a.role === filter.role);
    if (filter?.visibility) agents = agents.filter(a => a.visibility === filter.visibility);
    if (filter?.provider) agents = agents.filter(a => a.provider === filter.provider);
    return agents;
  }

  async get(agentId: string): Promise<AgentMeta | undefined> {
    return this.store.get(agentId);
  }

  async getDetail(agentId: string): Promise<AgentDetail> {
    const meta = await this.store.get(agentId);
    if (!meta) throw new Error(`Agent not found: ${agentId}`);
    let claudeMd = '';
    try { claudeMd = await this.memory.read(agentId, 'CLAUDE.md'); } catch { /* */ }
    return { ...meta, claudeMd, journal: [], bookmarks: [] };
  }

  async update(agentId: string, updates: Partial<AgentMeta>): Promise<void> {
    await this.store.update(agentId, updates);
    this.dispatchEvent(new CustomEvent('updated', { detail: { agentId, updates } }));
  }

  async delete(agentId: string): Promise<void> {
    await this.store.remove(agentId);
    this.dispatchEvent(new CustomEvent('deleted', { detail: { agentId } }));
  }

  async archive(agentId: string): Promise<void> {
    await this.store.update(agentId, { role: 'archived', visibility: 'private' });
    this.dispatchEvent(new CustomEvent('archived', { detail: { agentId } }));
  }

  async restore(agentId: string): Promise<AgentMeta> {
    await this.store.update(agentId, { role: 'neutral', visibility: 'visible' });
    const agent = await this.store.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    this.dispatchEvent(new CustomEvent('restored', { detail: agent }));
    return agent;
  }

  /** @deprecated Use list({ includeArchived: true, role: 'archived' }) */
  async listArchived(): Promise<AgentMeta[]> {
    return this.list({ includeArchived: true, role: 'archived' });
  }

  async getClaudeMd(agentId: string): Promise<string> {
    return this.memory.read(agentId, 'CLAUDE.md');
  }

  async setClaudeMd(agentId: string, content: string): Promise<void> {
    await this.memory.write(agentId, 'CLAUDE.md', content);
    this.dispatchEvent(new CustomEvent('claudeMdChanged', { detail: { agentId } }));
  }

  async getModelConfig(agentId: string): Promise<AgentModelConfig> {
    const result = await this.requireEngine().send({ type: 'getModelConfig', agentId });
    return result as unknown as AgentModelConfig;
  }

  async setModelConfig(agentId: string, config: Partial<AgentModelConfig>): Promise<void> {
    await this.requireEngine().send({ type: 'setModelConfig', agentId, config });
    this.dispatchEvent(new CustomEvent('configChanged', { detail: { agentId, config } }));
  }
}

// ── Chat API ──

class ChatAPI extends EventTarget {
  /** Registered agent loops by ID */
  private agents = new Map<string, AgentLoop>();

  constructor(
    private engine: EngineConnection | undefined,
    private conversationStore: ConversationStore,
    agents?: AgentLoop[],
  ) {
    super();
    if (agents) {
      for (const agent of agents) {
        this.agents.set(agent.id, agent);
      }
    }
  }

  /** Register an agent loop (can be added after construction) */
  registerAgent(agent: AgentLoop): void {
    this.agents.set(agent.id, agent);
  }

  /** Unregister an agent loop */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** Get a registered agent loop */
  getAgent(agentId: string): AgentLoop | undefined {
    return this.agents.get(agentId);
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('ChatAPI: engine connection required for this operation');
    return this.engine;
  }

  async *send(agentId: string, message: string, options?: ChatOptions): AsyncIterable<ProgressUpdate> {
    this.dispatchEvent(new CustomEvent('start', { detail: { agentId, columnId: options?.columnId } }));
    const stream = this.requireEngine().stream({
      type: 'chat',
      agentId,
      message,
      ...options,
    });
    try {
      for await (const event of stream) {
        const update = event as unknown as ProgressUpdate;
        this.dispatchChatEvent(agentId, update, options?.columnId);
        yield update;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.dispatchEvent(new CustomEvent('error', { detail: { agentId, columnId: options?.columnId, error: errorMsg } }));
      throw err;
    }
  }

  async *sendMessage(agentId: string, message: string, options?: AgenticOptions): AsyncIterable<ProgressUpdate> {
    const agent = this.agents.get(agentId);
    if (agent) {
      yield* this.sendMessageViaAgent(agent, message, options);
    } else if (this.engine) {
      yield* this.sendMessageViaEngine(agentId, message, options);
    } else {
      throw new Error(`ChatAPI: no agent registered for "${agentId}" and no engine configured`);
    }
  }

  private async *sendMessageViaAgent(agent: AgentLoop, message: string, options?: AgenticOptions): AsyncIterable<ProgressUpdate> {
    const agentId = agent.id;
    this.dispatchEvent(new CustomEvent('start', { detail: { agentId, columnId: options?.columnId } }));

    try {
      for await (const event of agent.stream(message, options?.pageContext ? JSON.stringify(options.pageContext) : undefined)) {
        const update: ProgressUpdate = {
          type: event.type,
          content: event.content,
          toolName: event.toolName,
          toolArgs: event.toolArgs,
          toolResult: event.toolResult,
          iteration: event.step,
          totalIterations: event.totalSteps,
        };
        this.dispatchChatEvent(agentId, update, options?.columnId);
        yield update;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.dispatchEvent(new CustomEvent('error', { detail: { agentId, columnId: options?.columnId, error: errorMsg } }));
      throw err;
    }
  }

  private async *sendMessageViaEngine(agentId: string, message: string, options?: AgenticOptions): AsyncIterable<ProgressUpdate> {
    this.dispatchEvent(new CustomEvent('start', { detail: { agentId, columnId: options?.columnId } }));
    const stream = this.requireEngine().stream({
      type: 'agenticChat',
      agentId,
      message,
      ...options,
    });
    try {
      for await (const event of stream) {
        const update = event as unknown as ProgressUpdate;
        this.dispatchChatEvent(agentId, update, options?.columnId);
        yield update;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.dispatchEvent(new CustomEvent('error', { detail: { agentId, columnId: options?.columnId, error: errorMsg } }));
      throw err;
    }
  }

  async stop(agentId: string, _columnId?: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.abort();
      this.dispatchEvent(new CustomEvent('aborted', { detail: { agentId, columnId: _columnId } }));
      return;
    }
    if (this.engine) {
      await this.engine.send({ type: 'stopChat', agentId, columnId: _columnId });
    }
    this.dispatchEvent(new CustomEvent('aborted', { detail: { agentId, columnId: _columnId } }));
  }

  async getConversation(agentId: string, conversationId: string): Promise<Conversation | undefined> {
    return this.conversationStore.get(agentId, conversationId);
  }

  async listConversations(agentId: string): Promise<Array<{ id: string; timestamp: string }>> {
    return this.conversationStore.list(agentId);
  }

  async saveConversation(agentId: string, conversationId: string, conversation: Conversation): Promise<void> {
    await this.conversationStore.save(agentId, conversation);
  }

  async deleteConversation(agentId: string, conversationId: string): Promise<void> {
    await this.conversationStore.delete(agentId, conversationId);
  }

  private dispatchChatEvent(agentId: string, update: ProgressUpdate, columnId?: string): void {
    switch (update.type) {
      case 'thinking':
      case 'text':
        this.dispatchEvent(new CustomEvent('chunk', { detail: { agentId, columnId, chunk: update.content } }));
        break;
      case 'tool-call':
        this.dispatchEvent(new CustomEvent('toolCall', { detail: { agentId, columnId, toolName: update.toolName, args: update.toolArgs } }));
        break;
      case 'tool-result':
        this.dispatchEvent(new CustomEvent('toolResult', { detail: { agentId, columnId, toolName: update.toolName, result: update.toolResult } }));
        break;
      case 'step-complete':
        this.dispatchEvent(new CustomEvent('stepComplete', { detail: { agentId, columnId, step: update.iteration } }));
        break;
      case 'done':
        this.dispatchEvent(new CustomEvent('done', { detail: { agentId, columnId, result: update.content } }));
        break;
      case 'error':
        this.dispatchEvent(new CustomEvent('error', { detail: { agentId, columnId, error: update.content } }));
        break;
    }
  }
}

// ── Hooks API ──

class HooksAPI extends EventTarget {
  constructor(
    private engine: EngineConnection | undefined,
    private store: HookStore,
  ) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('HooksAPI: engine connection required for this operation');
    return this.engine;
  }

  async list(filter?: { agentId?: string; enabled?: boolean; triggerType?: string }): Promise<Hook[]> {
    let hooks = await this.store.list(filter?.agentId);
    if (filter?.enabled !== undefined) hooks = hooks.filter(h => h.enabled === filter.enabled);
    if (filter?.triggerType) hooks = hooks.filter(h => h.trigger.type === filter.triggerType);
    return hooks;
  }

  async get(hookId: string): Promise<Hook | undefined> {
    return this.store.get(hookId);
  }

  async create(hook: Hook): Promise<Hook> {
    await this.store.add(hook);
    this.dispatchEvent(new CustomEvent('created', { detail: hook }));
    return hook;
  }

  async update(hookId: string, updates: Partial<Hook>): Promise<void> {
    await this.store.update(hookId, updates);
    const updated = await this.store.get(hookId);
    this.dispatchEvent(new CustomEvent('updated', { detail: updated }));
    if (updates.enabled === true) {
      this.dispatchEvent(new CustomEvent('enabled', { detail: { hookId } }));
    } else if (updates.enabled === false) {
      this.dispatchEvent(new CustomEvent('disabled', { detail: { hookId } }));
    }
  }

  async delete(hookId: string): Promise<void> {
    await this.store.remove(hookId);
    this.dispatchEvent(new CustomEvent('removed', { detail: { hookId } }));
  }

  async trigger(hookId: string, context?: Record<string, unknown>): Promise<void> {
    const hook = await this.store.get(hookId);
    if (!hook) throw new Error(`Hook not found: ${hookId}`);
    await this.requireEngine().send({ type: 'triggerHook', hookId, context });
    this.dispatchEvent(new CustomEvent('triggered', { detail: { hookId, agentId: hook.agentId, context } }));
  }
}

// ── Channels API ──

class ChannelsAPI extends EventTarget {
  constructor(
    private engine: EngineConnection | undefined,
    private relay?: RelayConnection,
  ) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('ChannelsAPI: engine connection required for this operation');
    return this.engine;
  }

  async register(config: ChannelConfig): Promise<ChannelConfig> {
    const result = await this.requireEngine().send({ type: 'registerChannel', config });
    const channel = result as unknown as ChannelConfig;
    this.dispatchEvent(new CustomEvent('registered', { detail: channel }));
    return channel;
  }

  async list(): Promise<ChannelConfig[]> {
    const result = await this.requireEngine().send({ type: 'listChannels' });
    return result as unknown as ChannelConfig[];
  }

  async update(channelId: string, updates: Partial<ChannelConfig>): Promise<ChannelConfig> {
    const result = await this.requireEngine().send({ type: 'updateChannel', channelId, updates });
    const channel = result as unknown as ChannelConfig;
    this.dispatchEvent(new CustomEvent('updated', { detail: channel }));
    return channel;
  }

  async remove(channelId: string): Promise<void> {
    await this.requireEngine().send({ type: 'removeChannel', channelId });
    this.dispatchEvent(new CustomEvent('removed', { detail: { channelId } }));
  }

  async getMessages(channelId: string, options?: PaginationOptions): Promise<ChannelMessage[]> {
    const result = await this.requireEngine().send({ type: 'getChannelMessages', channelId, ...options });
    return result as unknown as ChannelMessage[];
  }
}

// ── Artifacts API ──

class ArtifactsAPI extends EventTarget {
  constructor(private engine: EngineConnection | undefined) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('ArtifactsAPI: engine connection required for this operation');
    return this.engine;
  }

  async list(filter?: { agentId?: string }): Promise<ArtifactMeta[]> {
    const result = await this.requireEngine().send({ type: 'listArtifacts', agentId: filter?.agentId });
    return result as unknown as ArtifactMeta[];
  }

  async get(agentId: string, path: string): Promise<ArtifactMeta> {
    const result = await this.requireEngine().send({ type: 'getArtifact', agentId, path });
    return result as unknown as ArtifactMeta;
  }

  async delete(agentId: string, path: string): Promise<void> {
    await this.requireEngine().send({ type: 'deleteArtifact', agentId, path });
    this.dispatchEvent(new CustomEvent('deleted', { detail: { agentId, artifactId: path } }));
  }
}

// ── Files API ──

class FilesAPI extends EventTarget {
  constructor(private memory: MemoryStore) {
    super();
  }

  async read(agentId: string, path: string): Promise<string> {
    return this.memory.read(agentId, path);
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    await this.memory.write(agentId, path, content);
    this.dispatchEvent(new CustomEvent('written', { detail: { agentId, path } }));
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    return this.memory.list(agentId, path);
  }

  async delete(agentId: string, path: string): Promise<void> {
    await this.memory.delete(agentId, path);
    this.dispatchEvent(new CustomEvent('deleted', { detail: { agentId, path } }));
  }

  async search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>> {
    return this.memory.search(agentId, pattern, path);
  }

  async mkdir(agentId: string, path: string): Promise<void> {
    await this.memory.mkdir(agentId, path);
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    return this.memory.exists(agentId, path);
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    await this.memory.append(agentId, path, content);
    this.dispatchEvent(new CustomEvent('written', { detail: { agentId, path } }));
  }
}

// ── Skills API ──

class SkillsAPI extends EventTarget {
  constructor(private engine: EngineConnection | undefined) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('SkillsAPI: engine connection required for this operation');
    return this.engine;
  }

  async list(agentId: string): Promise<SkillMeta[]> {
    const result = await this.requireEngine().send({ type: 'listSkills', agentId });
    return result as unknown as SkillMeta[];
  }

  async install(agentId: string, skill: SkillMeta): Promise<SkillMeta> {
    const result = await this.requireEngine().send({ type: 'installSkill', agentId, skill });
    const installed = result as unknown as SkillMeta;
    this.dispatchEvent(new CustomEvent('installed', { detail: { agentId, skill: installed } }));
    return installed;
  }

  async remove(agentId: string, skillId: string): Promise<void> {
    await this.requireEngine().send({ type: 'removeSkill', agentId, skillId });
    this.dispatchEvent(new CustomEvent('removed', { detail: { agentId, skillId } }));
  }

  async search(query: string): Promise<SkillSearchResult[]> {
    const result = await this.requireEngine().send({ type: 'searchSkills', query });
    return result as unknown as SkillSearchResult[];
  }
}

// ── Tasks API ──

class TasksAPI extends EventTarget {
  constructor(private engine: EngineConnection | undefined) {
    super();
  }

  private requireEngine(): EngineConnection {
    if (!this.engine) throw new Error('TasksAPI: engine connection required for this operation');
    return this.engine;
  }

  async list(filter?: { agentId?: string; status?: string }): Promise<Task[]> {
    const result = await this.requireEngine().send({ type: 'listTasks', agentId: filter?.agentId });
    return result as unknown as Task[];
  }

  async create(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const result = await this.requireEngine().send({ type: 'createTask', task });
    const created = result as unknown as Task;
    this.dispatchEvent(new CustomEvent('created', { detail: created }));
    return created;
  }

  async get(taskId: string): Promise<Task> {
    const result = await this.requireEngine().send({ type: 'getTask', taskId });
    return result as unknown as Task;
  }

  async cancel(taskId: string): Promise<void> {
    await this.requireEngine().send({ type: 'cancelTask', taskId });
    this.dispatchEvent(new CustomEvent('cancelled', { detail: { taskId } }));
  }
}

// ── Usage API ──

class UsageAPI extends EventTarget {
  constructor(
    private engine: EngineConnection | undefined,
    private store: UsageStore,
    private settingsStore: SettingsStore,
  ) {
    super();
  }

  async getSummary(since?: string): Promise<UsageSummary> {
    const records = await this.store.query(since ? { since } : undefined);
    return this.computeSummary(records);
  }

  async getRecords(options?: UsageQueryOptions): Promise<UsageRecord[]> {
    return this.store.query(options);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  async record(entry: UsageRecord): Promise<void> {
    await this.store.record(entry);
    this.dispatchEvent(new CustomEvent('recorded', { detail: entry }));
  }

  async getSpendingLimit(agentId: string): Promise<number | null> {
    const limit = await this.settingsStore.get<number>(`spendingLimit:${agentId}`);
    return limit ?? null;
  }

  async setSpendingLimit(agentId: string, limit: number | null): Promise<void> {
    if (limit === null) {
      await this.settingsStore.remove(`spendingLimit:${agentId}`);
    } else {
      await this.settingsStore.set(`spendingLimit:${agentId}`, limit);
    }
  }

  private computeSummary(records: UsageRecord[]): UsageSummary {
    const summary: UsageSummary = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: records.length,
      byProvider: {},
      byAgent: {},
      byModel: {},
    };

    for (const r of records) {
      summary.totalCost += r.estimatedCost;
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;

      if (!summary.byProvider[r.provider]) {
        summary.byProvider[r.provider] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
      }
      summary.byProvider[r.provider].cost += r.estimatedCost;
      summary.byProvider[r.provider].inputTokens += r.inputTokens;
      summary.byProvider[r.provider].outputTokens += r.outputTokens;
      summary.byProvider[r.provider].requests += 1;

      if (!summary.byAgent[r.agentId]) {
        summary.byAgent[r.agentId] = { name: r.agentName, cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
      }
      summary.byAgent[r.agentId].cost += r.estimatedCost;
      summary.byAgent[r.agentId].inputTokens += r.inputTokens;
      summary.byAgent[r.agentId].outputTokens += r.outputTokens;
      summary.byAgent[r.agentId].requests += 1;

      if (!summary.byModel[r.model]) {
        summary.byModel[r.model] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
      }
      summary.byModel[r.model].cost += r.estimatedCost;
      summary.byModel[r.model].inputTokens += r.inputTokens;
      summary.byModel[r.model].outputTokens += r.outputTokens;
      summary.byModel[r.model].requests += 1;
    }

    return summary;
  }
}

// ── Settings API ──

class SettingsAPI extends EventTarget {
  constructor(private store: SettingsStore) {
    super();
  }

  async get(): Promise<Settings> {
    const result = await this.store.get<Settings>('settings');
    return result ?? { activeProvider: 'anthropic', theme: 'system' };
  }

  async update(updates: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const updated = { ...current, ...updates };
    await this.store.set('settings', updated);
    for (const [key, value] of Object.entries(updates)) {
      this.dispatchEvent(new CustomEvent('changed', { detail: { key, value } }));
    }
    if (updates.activeProvider) {
      this.dispatchEvent(new CustomEvent('providerChanged', { detail: { provider: updates.activeProvider } }));
    }
    return updated;
  }

  async getApiKeys(): Promise<ApiKeys> {
    const result = await this.store.get<ApiKeys>('apiKeys');
    return result ?? {};
  }

  async setApiKeys(keys: ApiKeys): Promise<void> {
    await this.store.set('apiKeys', keys);
  }
}

// ── Main SDK ──

export class ChaosSDK {
  readonly agents: AgentsAPI;
  readonly chat: ChatAPI;
  readonly hooks: HooksAPI;
  readonly channels: ChannelsAPI;
  readonly artifacts: ArtifactsAPI;
  readonly files: FilesAPI;
  readonly skills: SkillsAPI;
  readonly tasks: TasksAPI;
  readonly usage: UsageAPI;
  readonly settings: SettingsAPI;
  readonly browser?: BrowserCapabilities;
  readonly scheduler?: TaskScheduler;
  readonly pageParser?: PageParser;

  constructor(options: ChaosSDKOptions) {
    this.agents = new AgentsAPI(options.engine, options.agentStore, options.memory);
    this.chat = new ChatAPI(options.engine, options.conversations, options.agents);
    this.hooks = new HooksAPI(options.engine, options.hooks);
    this.channels = new ChannelsAPI(options.engine, options.relay);
    this.artifacts = new ArtifactsAPI(options.engine);
    this.files = new FilesAPI(options.memory);
    this.skills = new SkillsAPI(options.engine);
    this.tasks = new TasksAPI(options.engine);
    this.usage = new UsageAPI(options.engine, options.usage, options.settings);
    this.settings = new SettingsAPI(options.settings);
    this.browser = options.browser;
    this.scheduler = options.scheduler;
    this.pageParser = options.pageParser;
  }
}
