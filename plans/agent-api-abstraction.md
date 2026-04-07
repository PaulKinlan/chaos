# Plan: Agent API Abstraction Layer

## Status

All phases: TODO.

---

## Problem

CHAOS currently has its agent management, channels, hooks, artifacts, and configuration tightly coupled to the app.ts UI. This makes it impossible for:
- Third-party developers to build alternative UIs (mobile, CLI, web app, embedded)
- Other extensions to create/manage agents programmatically
- Automated workflows to configure agents without the UI

The core agent capabilities (create, configure, chat, manage hooks/channels/artifacts) need to be exposed as a clean API that any UI can consume.

## Goals

1. Define a clear Agent API boundary between the "engine" (background service worker) and the "UI" (app.ts or any consumer)
2. Every operation the UI performs should go through this API — no direct storage access from the UI
3. The API should be sufficient to rebuild the entire current UI from scratch
4. Enable alternative frontends: mobile companion app, CLI tool, web dashboard, embedded widget
5. Support both synchronous (request/response) and streaming (chat, agentic loops) patterns

## Current Architecture

```
┌──────────────────────────────────────────────┐
│ app.ts (UI)                                  │
│ - Direct chrome.storage access               │
│ - sendMsg() → background one-shot handler    │
│ - sendPortMessage() → background port handler│
│ - Direct relay-client.ts calls               │
│ - Direct OPFS access via some tools          │
└──────────────┬───────────────────────────────┘
               │ chrome.runtime.Port
               │ chrome.runtime.sendMessage
┌──────────────┴───────────────────────────────┐
│ background.ts (Service Worker)               │
│ - Agent CRUD (manager.ts)                    │
│ - Chat loops (loop.ts, agentic-loop.ts)      │
│ - Hook management                            │
│ - Scheduled tasks                            │
│ - Channel polling                            │
│ - Context menus                              │
└──────────────────────────────────────────────┘
```

### Problems with current approach:
- Message types are ad-hoc strings (`'createAgent'`, `'getSettings'`, etc.)
- No type safety between UI and background
- Some operations go through `sendMsg` (one-shot), others through `sendPortMessage` (port)
- Relay client is called directly from UI for channel operations
- No versioning, no documentation, no discoverability

## Proposed Architecture

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐
│ app.ts (NTP) │  │ CLI client  │  │ Mobile app   │
│ Primary UI   │  │ Future      │  │ Future       │
└──────┬───────┘  └──────┬──────┘  └──────┬───────┘
       │                 │                 │
       └────────┬────────┴────────┬────────┘
                │                 │
        ┌───────┴─────────────────┴────────┐
        │ Agent SDK (TypeScript module)     │
        │ - Typed methods for every op     │
        │ - Handles transport (port/msg)   │
        │ - Event subscriptions            │
        │ - Streaming helpers              │
        └───────────────┬──────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        │ background.ts (Engine)            │
        │ - Receives typed API messages     │
        │ - Dispatches to subsystems        │
        │ - Emits typed events              │
        └──────────────────────────────────┘
```

## Type Reference

All types referenced in the API surface below already exist in the codebase. The SDK should re-export them from a single entry point (`sdk/types.ts`).

### Core Types (from `packages/extension/src/storage/types.ts`)

| Type | Location | Description |
|------|----------|-------------|
| `AgentMeta` | `storage/types.ts:3` | Agent identity, role, visibility, provider/model overrides, master/temporary flags |
| `Settings` | `storage/types.ts:21` | Global settings: active provider, theme, default model |
| `ApiKeys` | `storage/types.ts:29` | Per-provider API keys (anthropic, openai, google, openrouter, ollama/baseURL, brave) |
| `Hook` | `storage/types.ts:167` | Hook definition: id, agentId, trigger, prompt, description, enabled, stats |
| `HookTrigger` | `storage/types.ts:179` | Discriminated union of 16 trigger types (bookmark-created, tab-navigated, context-menu, etc.) |
| `Task` | `storage/types.ts:60` | Shared task: id, subject, description, owner, status, blockedBy, result |
| `TaskData` | `storage/types.ts:60` | Task creation input (same fields minus id/timestamps) |
| `ArtifactMeta` | `storage/types.ts:83` | Artifact reference: agentId, path, description, timestamp |
| `Conversation` | `storage/types.ts:92` | Conversation: id, agentId, timestamp, messages array |
| `ConversationMessage` | `storage/types.ts:99` | Message with role, content, timestamp, optional progress entries |
| `AgenticProgressEntry` | `storage/types.ts:106` | Step detail: step-start, tool-call, tool-result, thinking, text |

### Channel Types (from `packages/extension/src/channels/types.ts` and `packages/shared/src/types.ts`)

| Type | Location | Description |
|------|----------|-------------|
| `ChannelConfig` | `channels/types.ts:18` | Channel definition: id, type, direction, agentId, name, prompt, metadata |
| `ChannelMessage` | `channels/types.ts:4` | Inbound message: id, channelType, channelId, from, content, metadata |
| `ChannelResponse` | `channels/types.ts:35` | Outbound reply: channelType, channelId, replyTo, content, metadata |
| `ChannelDirection` | `shared/src/types.ts:33` | `'inbound' \| 'bidirectional'` |

### Agent System Types

| Type | Location | Description |
|------|----------|-------------|
| `AgentModelConfig` | `agents/model-config.ts:12` | Resolved config: provider, model, apiKey |
| `ProviderConfig` | `agents/provider-registry.ts:29` | Provider definition: id, displayName, defaultModel, models, features |
| `ProviderId` | `agents/provider-registry.ts:16` | `'anthropic' \| 'openai' \| 'google' \| 'openrouter' \| 'ollama'` |
| `ProgressUpdate` | `agents/agentic-loop.ts:34` | Loop progress: type (thinking/tool-call/tool-result/text/step-complete/done/error), content, tool info, iteration |
| `UsageRecord` | `agents/usage.ts:12` | Token usage: agentId, agentName, provider, model, inputTokens, outputTokens, estimatedCost, source |
| `UsageSummary` | `agents/usage.ts:107` | Aggregated stats: totals + breakdown byProvider, byAgent, byModel |
| `SkillMeta` | `agents/skills.ts:13` | Installed skill: id, name, description, author, version, source, files |
| `SkillManifest` | `shared/src/types.ts:40` | Skill manifest for search/install: id, name, description, tags |

### Types to Create

| Type | Purpose |
|------|---------|
| `Job` | Not yet defined — represents a delegated job from master to sub-agent (currently tracked via Task + events) |
| `AgentDetail` | Combine AgentMeta + CLAUDE.md content + journal + bookmarks (currently ad-hoc in getAgentDetail handler) |
| `FileEntry` | File listing entry: name, type (file/directory), size |
| `SkillSearchResult` | Search result from featured/GitHub skill search |
| `ChatOptions` | Options for single-turn chat: pageContext, toolLookupStrategy |
| `AgenticOptions` | Options for agentic chat: pageContext, maxIterations, columnId, source |
| `PaginationOptions` | Cursor-based pagination: limit, cursor, since |

## API Surface

### 1. Agents

```typescript
// CRUD
sdk.agents.create(name: string, role: string): Promise<AgentMeta>
sdk.agents.list(): Promise<AgentMeta[]>
sdk.agents.get(agentId: string): Promise<AgentDetail>
sdk.agents.update(agentId: string, updates: Partial<AgentMeta>): Promise<AgentMeta>
sdk.agents.delete(agentId: string): Promise<void>
sdk.agents.archive(agentId: string): Promise<void>
sdk.agents.restore(agentId: string): Promise<AgentMeta>
sdk.agents.listArchived(): Promise<AgentMeta[]>

// Configuration
sdk.agents.getClaudeMd(agentId: string): Promise<string>
sdk.agents.setClaudeMd(agentId: string, content: string): Promise<void>
sdk.agents.getModelConfig(agentId: string): Promise<ModelConfig>
sdk.agents.setModelConfig(agentId: string, config: Partial<ModelConfig>): Promise<void>
```

### 2. Chat

```typescript
// Single-turn (non-agentic)
sdk.chat.send(agentId: string, message: string, options?: ChatOptions): AsyncIterable<ChatEvent>

// Multi-turn agentic
sdk.chat.sendAgentic(agentId: string, message: string, options?: AgenticOptions): AsyncIterable<AgenticEvent>

// Stop
sdk.chat.stop(agentId: string): Promise<void>

// Conversations
sdk.chat.getConversation(agentId: string, conversationId: string): Promise<Conversation>
sdk.chat.listConversations(agentId: string): Promise<ConversationMeta[]>
sdk.chat.deleteConversation(agentId: string, conversationId: string): Promise<void>
```

### 3. Hooks

```typescript
sdk.hooks.create(hook: HookInput): Promise<Hook>
sdk.hooks.list(agentId?: string): Promise<Hook[]>
sdk.hooks.update(hookId: string, updates: Partial<Hook>): Promise<Hook>
sdk.hooks.delete(hookId: string): Promise<void>
sdk.hooks.trigger(hookId: string, context?: Record<string, unknown>): Promise<void>
```

### 4. Channels

```typescript
sdk.channels.register(type: string, config: ChannelConfig): Promise<Channel>
sdk.channels.list(): Promise<Channel[]>
sdk.channels.update(channelId: string, updates: Partial<ChannelConfig>): Promise<Channel>
sdk.channels.remove(channelId: string): Promise<void>
sdk.channels.getMessages(channelId: string, options?: PaginationOptions): Promise<Message[]>
```

### 5. Artifacts

```typescript
sdk.artifacts.list(agentId?: string): Promise<Artifact[]>
sdk.artifacts.get(agentId: string, artifactId: string): Promise<Artifact>
sdk.artifacts.delete(agentId: string, artifactId: string): Promise<void>
```

### 6. Files (Agent Storage)

```typescript
sdk.files.read(agentId: string, path: string): Promise<string>
sdk.files.write(agentId: string, path: string, content: string): Promise<void>
sdk.files.list(agentId: string, path?: string): Promise<FileEntry[]>
sdk.files.delete(agentId: string, path: string): Promise<void>
sdk.files.search(agentId: string, pattern: string, path?: string): Promise<SearchResult[]>
```

### 7. Skills

```typescript
sdk.skills.list(agentId: string): Promise<Skill[]>
sdk.skills.install(agentId: string, skill: SkillInput): Promise<Skill>
sdk.skills.remove(agentId: string, skillId: string): Promise<void>
sdk.skills.search(query: string): Promise<SkillSearchResult[]>
```

### 8. Tasks & Jobs

```typescript
sdk.tasks.list(agentId?: string): Promise<Task[]>
sdk.tasks.create(task: TaskInput): Promise<Task>
sdk.tasks.get(taskId: string): Promise<Task>
sdk.tasks.cancel(taskId: string): Promise<void>
sdk.jobs.list(): Promise<Job[]>
sdk.jobs.get(jobId: string): Promise<Job>
```

### 9. Settings

```typescript
sdk.settings.get(): Promise<Settings>
sdk.settings.update(updates: Partial<Settings>): Promise<Settings>
sdk.settings.getApiKeys(): Promise<ApiKeys>
sdk.settings.setApiKeys(keys: ApiKeys): Promise<void>
```

### 10. Usage

```typescript
sdk.usage.getSummary(since?: string): Promise<UsageSummary>
sdk.usage.getRecords(options?: UsageQueryOptions): Promise<UsageRecord[]>
sdk.usage.clear(): Promise<void>
sdk.usage.getSpendingLimit(agentId: string): Promise<number | null>
sdk.usage.setSpendingLimit(agentId: string, limit: number | null): Promise<void>
```

### 11. Events

Each domain class extends `EventTarget` and dispatches typed `CustomEvent`s, following the standard web platform pattern.

```typescript
// ── Agents ──
sdk.agents.addEventListener('created', (e: CustomEvent<AgentMeta>) => {})
sdk.agents.addEventListener('updated', (e: CustomEvent<{ agentId: string; updates: Partial<AgentMeta> }>) => {})
sdk.agents.addEventListener('deleted', (e: CustomEvent<{ agentId: string }>) => {})
sdk.agents.addEventListener('archived', (e: CustomEvent<{ agentId: string }>) => {})
sdk.agents.addEventListener('restored', (e: CustomEvent<AgentMeta>) => {})
sdk.agents.addEventListener('configChanged', (e: CustomEvent<{ agentId: string; config: ModelConfig }>) => {})
sdk.agents.addEventListener('claudeMdChanged', (e: CustomEvent<{ agentId: string }>) => {})

// ── Chat ──
sdk.chat.addEventListener('start', (e: CustomEvent<{ agentId: string; columnId?: string }>) => {})
sdk.chat.addEventListener('chunk', (e: CustomEvent<{ agentId: string; columnId?: string; chunk: string }>) => {})
sdk.chat.addEventListener('toolCall', (e: CustomEvent<{ agentId: string; columnId?: string; toolName: string; args: unknown }>) => {})
sdk.chat.addEventListener('toolResult', (e: CustomEvent<{ agentId: string; columnId?: string; toolName: string; result: unknown }>) => {})
sdk.chat.addEventListener('stepStart', (e: CustomEvent<{ agentId: string; columnId?: string; step: number }>) => {})
sdk.chat.addEventListener('stepComplete', (e: CustomEvent<{ agentId: string; columnId?: string; step: number }>) => {})
sdk.chat.addEventListener('done', (e: CustomEvent<{ agentId: string; columnId?: string; result: string }>) => {})
sdk.chat.addEventListener('error', (e: CustomEvent<{ agentId: string; columnId?: string; error: string }>) => {})
sdk.chat.addEventListener('aborted', (e: CustomEvent<{ agentId: string; columnId?: string }>) => {})

// ── Hooks ──
sdk.hooks.addEventListener('created', (e: CustomEvent<Hook>) => {})
sdk.hooks.addEventListener('updated', (e: CustomEvent<Hook>) => {})
sdk.hooks.addEventListener('removed', (e: CustomEvent<{ hookId: string }>) => {})
sdk.hooks.addEventListener('triggered', (e: CustomEvent<{ hookId: string; agentId: string; context: unknown }>) => {})
sdk.hooks.addEventListener('enabled', (e: CustomEvent<{ hookId: string }>) => {})
sdk.hooks.addEventListener('disabled', (e: CustomEvent<{ hookId: string }>) => {})

// ── Channels ──
sdk.channels.addEventListener('registered', (e: CustomEvent<Channel>) => {})
sdk.channels.addEventListener('updated', (e: CustomEvent<Channel>) => {})
sdk.channels.addEventListener('removed', (e: CustomEvent<{ channelId: string }>) => {})
sdk.channels.addEventListener('messageReceived', (e: CustomEvent<ChannelMessage>) => {})
sdk.channels.addEventListener('replySent', (e: CustomEvent<{ channelId: string; content: string }>) => {})

// ── Artifacts ──
sdk.artifacts.addEventListener('created', (e: CustomEvent<Artifact>) => {})
sdk.artifacts.addEventListener('deleted', (e: CustomEvent<{ agentId: string; artifactId: string }>) => {})

// ── Files ──
sdk.files.addEventListener('written', (e: CustomEvent<{ agentId: string; path: string }>) => {})
sdk.files.addEventListener('deleted', (e: CustomEvent<{ agentId: string; path: string }>) => {})

// ── Skills ──
sdk.skills.addEventListener('installed', (e: CustomEvent<{ agentId: string; skill: Skill }>) => {})
sdk.skills.addEventListener('removed', (e: CustomEvent<{ agentId: string; skillId: string }>) => {})

// ── Tasks & Jobs ──
sdk.tasks.addEventListener('created', (e: CustomEvent<Task>) => {})
sdk.tasks.addEventListener('started', (e: CustomEvent<{ taskId: string; agentId: string }>) => {})
sdk.tasks.addEventListener('completed', (e: CustomEvent<{ taskId: string; result: string }>) => {})
sdk.tasks.addEventListener('failed', (e: CustomEvent<{ taskId: string; error: string }>) => {})
sdk.tasks.addEventListener('cancelled', (e: CustomEvent<{ taskId: string }>) => {})
sdk.jobs.addEventListener('created', (e: CustomEvent<Job>) => {})
sdk.jobs.addEventListener('statusChanged', (e: CustomEvent<{ jobId: string; status: string }>) => {})
sdk.jobs.addEventListener('completed', (e: CustomEvent<{ jobId: string; result: string }>) => {})

// ── Usage ──
sdk.usage.addEventListener('recorded', (e: CustomEvent<UsageRecord>) => {})
sdk.usage.addEventListener('limitExceeded', (e: CustomEvent<{ agentId: string; spent: number; limit: number }>) => {})
sdk.usage.addEventListener('alertTriggered', (e: CustomEvent<{ spent: number; limit: number }>) => {})

// ── Settings ──
sdk.settings.addEventListener('changed', (e: CustomEvent<{ key: string; value: unknown }>) => {})
sdk.settings.addEventListener('providerChanged', (e: CustomEvent<{ provider: string }>) => {})
```

Each domain class implements this via `EventTarget`:

```typescript
class AgentsAPI extends EventTarget {
  async create(name: string, role: string): Promise<AgentMeta> {
    const agent = await this.transport.send({ type: 'createAgent', name, role });
    this.dispatchEvent(new CustomEvent('created', { detail: agent }));
    return agent;
  }
  // ...
}
```

Events are fired both when the local SDK performs an action AND when the background engine notifies of external changes (e.g. an agent created a task via a tool call, a hook was triggered by a browser event). This ensures any UI built on the SDK stays in sync with the engine state.

## Implementation Phases

### Phase 1: Define Types & SDK Shell

1. Create `packages/extension/src/sdk/types.ts` — all API types
2. Create `packages/extension/src/sdk/index.ts` — SDK class with method stubs
3. Create `packages/extension/src/sdk/transport.ts` — handles port/message communication
4. All methods initially throw "not implemented"
5. **Deliverable**: importable SDK module with full type definitions

### Phase 2: Migrate Agent CRUD

1. Implement `sdk.agents.*` methods
2. Create corresponding handlers in background.ts (consolidate existing ones)
3. Migrate app.ts agent operations to use the SDK
4. Keep backward compatibility (old message types still work)
5. **Deliverable**: agent management works through SDK

### Phase 3: Migrate Chat

1. Implement `sdk.chat.*` with streaming support
2. The SDK wraps the port-based streaming in AsyncIterable
3. Migrate app.ts chat columns to use SDK
4. **Deliverable**: chat works through SDK with proper streaming types

### Phase 4: Migrate Hooks, Channels, Artifacts

1. Implement remaining CRUD operations
2. Migrate each view in app.ts to use SDK
3. Channel operations go through SDK (which proxies to relay-client internally)
4. **Deliverable**: all management UIs use SDK

### Phase 5: Migrate Settings, Usage, Files

1. Complete remaining SDK methods
2. Remove all direct `sendMsg`/`sendPortMessage` from app.ts
3. app.ts imports only from `sdk/index.ts`
4. **Deliverable**: app.ts is a pure consumer of the SDK

### Phase 6: Documentation & Examples

1. Generate API documentation from types
2. Example: build a minimal agent manager in 50 lines using the SDK
3. Example: build a CLI that creates and chats with agents
4. Publish SDK types as `@chaos/sdk` (or include in `@chaos/shared`)
5. **Deliverable**: external developers can build on the SDK

## Connection Layer

There are two distinct connections the SDK needs:

### 1. Engine Connection (`engine`)

How the SDK talks to the agent engine (the thing that runs agentic loops, manages tools, executes tasks). In the current architecture this is the background service worker. In a web app it could be a local server or a cloud-hosted engine.

```typescript
interface EngineConnection {
  /** Send a request and wait for a response */
  send(message: ApiMessage): Promise<ApiResponse>;
  /** Send a request and stream back events (chat chunks, progress, etc.) */
  stream(message: ApiMessage): AsyncIterable<ApiEvent>;
  /** Subscribe to engine-initiated events (hook triggered, task completed, etc.) */
  subscribe(event: string, handler: (data: unknown) => void): () => void;
}
```

Implementations:
- `ChromePortEngine` — chrome.runtime.Port + sendMessage (current)
- `WebSocketEngine` — WebSocket to a local or remote engine server
- `WorkerEngine` — SharedWorker/ServiceWorker postMessage (web app without a server)

### 2. Relay Connection (`relay`)

How the SDK talks to the relay server for external channels (Telegram, Discord, email, webhooks). Currently this is the `relay-client.ts` fetch-based client.

```typescript
interface RelayConnection {
  /** Register with the relay server */
  register(): Promise<{ userId: string; apiKey: string }>;
  /** Signed fetch to relay endpoints */
  fetch(path: string, options?: RequestInit): Promise<Response>;
  /** WebSocket connection for real-time channel messages */
  connect(): Promise<WebSocket>;
}
```

Implementations:
- `ChaosRelayConnection` — current relay-client.ts (ECDSA-signed fetch to chaos-relay.com)
- `NoRelayConnection` — stub for environments without external channels
- `CustomRelayConnection` — self-hosted relay server at a custom URL

### SDK Constructor

```typescript
const sdk = new ChaosSDK({
  // How to talk to the agent engine
  engine: new ChromePortEngine(),
  // How to talk to the relay server (optional — no channels without it)
  relay: new ChaosRelayConnection('https://chaos-relay.com'),

  // Persistence (semantic stores)
  settings: new ChromeSettingsStore(),
  memory: new OPFSMemoryStore(),
  conversations: new OPFSConversationStore(),
  hooks: new ChromeHookStore(),
  usage: new ChromeUsageStore(),
  agents: new ChromeAgentStore(),

  // Browser capabilities (optional)
  browser: new ChromeBrowserCapabilities(),
});
```

## Storage Abstraction Layer

Currently the engine is locked to Chrome via two storage mechanisms:

| Store | Used For | Chrome API | Web Alternative |
|-------|----------|------------|-----------------|
| `chrome.storage.local` | Settings, API keys, hooks, scheduled tasks, usage records, agent list, spending limits | `chrome.storage.local.get/set` | `localStorage`, IndexedDB, or server-side |
| OPFS (Origin Private File System) | Agent files (CLAUDE.md, memories/, conversations/, activity logs, skills, artifacts) | `navigator.storage.getDirectory()` | Same API (OPFS is a web standard), or filesystem API, or server-side storage |

OPFS is actually a web standard — it works in any modern browser, not just extensions. The real lock-in is `chrome.storage.local` and the Chrome extension APIs (permissions, alarms, bookmarks, history, tabs, etc.).

### Storage Interface — Semantic Stores

Rather than generic "KV" and "file" stores, name each store by its *purpose*. This makes the SDK self-documenting and lets different backends make different persistence decisions for each concern.

```typescript
// ── Settings: global config, provider keys, preferences ──
interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getMultiple<T>(keys: string[]): Promise<Record<string, T>>;
}

// ── Memory: per-agent file-based memory (CLAUDE.md, memories/, people/, etc.) ──
interface MemoryStore {
  read(agentId: string, path: string): Promise<string>;
  write(agentId: string, path: string, content: string): Promise<void>;
  append(agentId: string, path: string, content: string): Promise<void>;
  delete(agentId: string, path: string): Promise<void>;
  list(agentId: string, path?: string): Promise<FileEntry[]>;
  mkdir(agentId: string, path: string): Promise<void>;
  exists(agentId: string, path: string): Promise<boolean>;
  search(agentId: string, pattern: string, path?: string): Promise<SearchResult[]>;
}

// ── Conversations: chat history per agent ──
interface ConversationStore {
  get(agentId: string, conversationId: string): Promise<Conversation>;
  list(agentId: string): Promise<ConversationMeta[]>;
  save(agentId: string, conversation: Conversation): Promise<void>;
  delete(agentId: string, conversationId: string): Promise<void>;
}

// ── Hooks: automation rules ──
interface HookStore {
  list(agentId?: string): Promise<Hook[]>;
  get(hookId: string): Promise<Hook | undefined>;
  add(hook: Hook): Promise<void>;
  update(hookId: string, updates: Partial<Hook>): Promise<void>;
  remove(hookId: string): Promise<void>;
}

// ── Usage: token tracking and cost data ──
interface UsageStore {
  record(entry: UsageRecord): Promise<void>;
  query(options?: UsageQueryOptions): Promise<UsageRecord[]>;
  clear(): Promise<void>;
}

// ── Agents: agent registry ──
interface AgentStore {
  list(): Promise<AgentMeta[]>;
  get(agentId: string): Promise<AgentMeta | undefined>;
  add(agent: AgentMeta): Promise<void>;
  update(agentId: string, updates: Partial<AgentMeta>): Promise<void>;
  remove(agentId: string): Promise<void>;
}
```

### Implementations

Each semantic store can be backed by different technologies depending on the runtime:

| Store | Chrome Extension | Web App | Server-Hosted |
|-------|-----------------|---------|---------------|
| `settings` | `chrome.storage.local` | `localStorage` | REST API |
| `memory` | OPFS | OPFS | REST API + S3/disk |
| `conversations` | OPFS (JSONL) | OPFS / IndexedDB | Database |
| `hooks` | `chrome.storage.local` | IndexedDB | Database |
| `usage` | `chrome.storage.local` | IndexedDB | Database |
| `agents` | `chrome.storage.local` | IndexedDB | Database |

```typescript
// Chrome Extension — current implementation, refactored into interfaces
class ChromeSettingsStore implements SettingsStore { /* chrome.storage.local */ }
class OPFSMemoryStore implements MemoryStore { /* current opfs.ts wrapper */ }
class OPFSConversationStore implements ConversationStore { /* JSONL in OPFS */ }
class ChromeHookStore implements HookStore { /* chrome.storage.local */ }
class ChromeUsageStore implements UsageStore { /* chrome.storage.local */ }
class ChromeAgentStore implements AgentStore { /* chrome.storage.local */ }

// Web App — no chrome.* APIs needed
class WebSettingsStore implements SettingsStore { /* localStorage */ }
class WebHookStore implements HookStore { /* IndexedDB */ }
// Memory and Conversations use OPFS (web standard, works in all browsers)

// Server-hosted — fetch to a REST API
class RemoteSettingsStore implements SettingsStore { /* REST */ }
class RemoteMemoryStore implements MemoryStore { /* REST */ }
class RemoteAgentStore implements AgentStore { /* REST */ }
```

### Browser API Abstraction

Chrome-specific APIs (tabs, bookmarks, history, alarms, notifications) need a separate abstraction — these are capabilities, not storage. The SDK should accept a `BrowserCapabilities` interface:

```typescript
interface BrowserCapabilities {
  tabs?: {
    list(): Promise<TabInfo[]>;
    read(tabId: string): Promise<string>;
    open(url: string): Promise<TabInfo>;
    close(tabId: string): Promise<void>;
    // ...
  };
  bookmarks?: {
    search(query: string): Promise<BookmarkInfo[]>;
    add(url: string, title: string): Promise<void>;
    // ...
  };
  history?: {
    search(query: string, maxResults?: number): Promise<HistoryItem[]>;
  };
  notifications?: {
    show(title: string, message: string): Promise<void>;
  };
  // Each capability is optional — agents adapt to what's available
}
```

This means:
- In a Chrome extension: all capabilities available
- In a web app: tabs/bookmarks/history not available, but chat/files/hooks still work
- In a mobile app: could provide its own tab/bookmark equivalents
- Agents check capability availability before using tools (already partially implemented via permission checks)

### Migration Path

1. **Phase 2 addition**: Create `KVStore` and `FileStore` interfaces alongside the SDK
2. **Phase 3 addition**: `ChromeKVStore` and `OPFSFileStore` as default implementations
3. **Phase 5 addition**: `BrowserCapabilities` interface, Chrome implementation
4. **Phase 6 addition**: `WebKVStore` and `RemoteKVStore` for non-extension contexts
5. SDK constructor accepts stores and capabilities:

```typescript
// Chrome Extension (current)
const sdk = new ChaosSDK({
  transport: new ChromePortTransport(),
  settings: new ChromeSettingsStore(),
  memory: new OPFSMemoryStore(),
  conversations: new OPFSConversationStore(),
  hooks: new ChromeHookStore(),
  usage: new ChromeUsageStore(),
  agents: new ChromeAgentStore(),
  browser: new ChromeBrowserCapabilities(),
});

// Web app (no Chrome APIs)
const sdk = new ChaosSDK({
  transport: new WebSocketTransport('ws://localhost:3000'),
  settings: new WebSettingsStore(),
  memory: new OPFSMemoryStore(), // OPFS is a web standard
  conversations: new OPFSConversationStore(),
  hooks: new WebHookStore(),
  usage: new WebUsageStore(),
  agents: new WebAgentStore(),
  // no browser capabilities — agents adapt
});

// Server-hosted (everything remote)
const sdk = new ChaosSDK({
  transport: new WebSocketTransport('wss://api.example.com'),
  settings: new RemoteSettingsStore(apiUrl, token),
  memory: new RemoteMemoryStore(apiUrl, token),
  conversations: new RemoteConversationStore(apiUrl, token),
  hooks: new RemoteHookStore(apiUrl, token),
  usage: new RemoteUsageStore(apiUrl, token),
  agents: new RemoteAgentStore(apiUrl, token),
});
```

## Open Questions

1. **Should the SDK be a separate npm package?** Pro: clean dependency. Con: adds build complexity. Recommendation: start as internal module, extract later.

2. **How to handle streaming across transport boundaries?** Port-based streaming is Chrome-specific. For external consumers, we'd need WebSocket or SSE.

3. **Authentication for external consumers?** Extensions can use the extension ID. Web pages would need a token. Not needed for Phase 1-5.

4. **Should background.ts be refactored into a router?** Currently it's a giant switch statement. An API layer naturally suggests a router pattern. Do this incrementally in each phase.

5. **Backward compatibility?** Keep old message types working during migration (Phase 2-5). Remove in a future major version.
