# @chaos/sdk API Reference

Complete API reference for the `@chaos/sdk` package -- an SDK for building AI agent applications with pluggable stores, connections, and browser capabilities.

## ChaosSDK

### Constructor

```typescript
new ChaosSDK(options: ChaosSDKOptions)
```

### `ChaosSDKOptions`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine` | `EngineConnection` | no | Connection to the engine backend |
| `relay` | `RelayConnection` | no | Connection to the relay service |
| `settings` | `SettingsStore` | yes | Settings storage backend |
| `memory` | `MemoryStore` | yes | File/memory storage backend |
| `conversations` | `ConversationStore` | yes | Conversation storage backend |
| `hooks` | `HookStore` | yes | Hook storage backend |
| `usage` | `UsageStore` | yes | Usage record storage backend |
| `agentStore` | `AgentStore` | yes | Agent metadata storage backend |
| `browser` | `BrowserCapabilities` | no | Browser API access (tabs, bookmarks, etc.) |
| `agents` | `Agent[]` | no | Pre-configured agent-loop instances |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentsAPI` | Agent management |
| `chat` | `ChatAPI` | Chat and messaging |
| `hooks` | `HooksAPI` | Hook management |
| `channels` | `ChannelsAPI` | Channel management |
| `artifacts` | `ArtifactsAPI` | Artifact management |
| `files` | `FilesAPI` | File operations |
| `skills` | `SkillsAPI` | Skill management |
| `tasks` | `TasksAPI` | Task management |
| `usage` | `UsageAPI` | Usage tracking |
| `settings` | `SettingsAPI` | Settings management |

---

## Domain APIs

All domain APIs extend `EventTarget` and emit events via `addEventListener`.

---

### AgentsAPI

Manage agent lifecycle and configuration.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(name: string, role: string) => Promise<AgentMeta>` | Create a new agent |
| `list` | `() => Promise<AgentMeta[]>` | List all agents |
| `get` | `(agentId: string) => Promise<AgentMeta \| undefined>` | Get an agent by ID |
| `getDetail` | `(agentId: string) => Promise<AgentDetail>` | Get full agent detail (includes CLAUDE.md, journal, bookmarks) |
| `update` | `(agentId: string, updates: Partial<AgentMeta>) => Promise<void>` | Update agent metadata |
| `delete` | `(agentId: string) => Promise<void>` | Delete an agent |
| `archive` | `(agentId: string) => Promise<void>` | Archive an agent |
| `restore` | `(agentId: string) => Promise<AgentMeta>` | Restore an archived agent |
| `listArchived` | `() => Promise<AgentMeta[]>` | List archived agents |
| `getClaudeMd` | `(agentId: string) => Promise<string>` | Get agent's CLAUDE.md content |
| `setClaudeMd` | `(agentId: string, content: string) => Promise<void>` | Set agent's CLAUDE.md content |
| `getModelConfig` | `(agentId: string) => Promise<AgentModelConfig>` | Get agent's model configuration |
| `setModelConfig` | `(agentId: string, config: Partial<AgentModelConfig>) => Promise<void>` | Set agent's model configuration |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `created` | `AgentMeta` | Agent was created |
| `updated` | `{ agentId, updates }` | Agent metadata was updated |
| `deleted` | `{ agentId }` | Agent was deleted |
| `archived` | `{ agentId }` | Agent was archived |
| `restored` | `AgentMeta` | Agent was restored |
| `claudeMdChanged` | `{ agentId }` | Agent's CLAUDE.md was updated |
| `configChanged` | `{ agentId, config }` | Agent's model config was updated |

---

### ChatAPI

Send messages and manage conversations.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerAgent` | `(agent: Agent) => void` | Register an agent loop instance |
| `unregisterAgent` | `(agentId: string) => void` | Unregister an agent loop |
| `getAgent` | `(agentId: string) => Agent \| undefined` | Get a registered agent loop |
| `send` | `(agentId: string, message: string, options?: ChatOptions) => AsyncIterable<ProgressUpdate>` | Send a message via engine connection |
| `sendMessage` | `(agentId: string, message: string, options?: AgenticOptions) => AsyncIterable<ProgressUpdate>` | Send a message (auto-routes to agent loop or engine) |
| `stop` | `(agentId: string, columnId?: string) => Promise<void>` | Stop/abort a running conversation |
| `getConversation` | `(agentId: string, conversationId: string) => Promise<Conversation \| undefined>` | Get a conversation by ID |
| `listConversations` | `(agentId: string) => Promise<Array<{ id, timestamp }>>` | List conversations for an agent |
| `deleteConversation` | `(agentId: string, conversationId: string) => Promise<void>` | Delete a conversation |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `start` | `{ agentId, columnId? }` | Chat started |
| `chunk` | `{ agentId, columnId?, chunk }` | Text chunk received |
| `toolCall` | `{ agentId, columnId?, toolName, args }` | Tool call initiated |
| `toolResult` | `{ agentId, columnId?, toolName, result }` | Tool call completed |
| `stepComplete` | `{ agentId, columnId?, step }` | Agent step completed |
| `done` | `{ agentId, columnId?, result }` | Chat completed |
| `error` | `{ agentId, columnId?, error }` | Error occurred |
| `aborted` | `{ agentId, columnId? }` | Chat was aborted |

---

### HooksAPI

Manage event hooks that trigger agent actions.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `list` | `(agentId?: string) => Promise<Hook[]>` | List hooks (optionally filtered by agent) |
| `get` | `(hookId: string) => Promise<Hook \| undefined>` | Get a hook by ID |
| `create` | `(hook: Hook) => Promise<Hook>` | Create a new hook |
| `update` | `(hookId: string, updates: Partial<Hook>) => Promise<void>` | Update a hook |
| `delete` | `(hookId: string) => Promise<void>` | Delete a hook |
| `trigger` | `(hookId: string, context?: Record<string, unknown>) => Promise<void>` | Manually trigger a hook |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `created` | `Hook` | Hook was created |
| `updated` | `Hook` | Hook was updated |
| `removed` | `{ hookId }` | Hook was removed |
| `enabled` | `{ hookId }` | Hook was enabled |
| `disabled` | `{ hookId }` | Hook was disabled |
| `triggered` | `{ hookId, agentId, context }` | Hook was triggered |

---

### ChannelsAPI

Manage communication channels (e.g. messaging integrations).

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(config: ChannelConfig) => Promise<ChannelConfig>` | Register a new channel |
| `list` | `() => Promise<ChannelConfig[]>` | List all channels |
| `update` | `(channelId: string, updates: Partial<ChannelConfig>) => Promise<ChannelConfig>` | Update a channel |
| `remove` | `(channelId: string) => Promise<void>` | Remove a channel |
| `getMessages` | `(channelId: string, options?: PaginationOptions) => Promise<ChannelMessage[]>` | Get messages for a channel |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `registered` | `ChannelConfig` | Channel was registered |
| `updated` | `ChannelConfig` | Channel was updated |
| `removed` | `{ channelId }` | Channel was removed |

---

### ArtifactsAPI

Manage artifacts produced by agents.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `list` | `(agentId?: string) => Promise<ArtifactMeta[]>` | List artifacts |
| `get` | `(agentId: string, path: string) => Promise<ArtifactMeta>` | Get an artifact |
| `delete` | `(agentId: string, path: string) => Promise<void>` | Delete an artifact |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `deleted` | `{ agentId, artifactId }` | Artifact was deleted |

---

### FilesAPI

Read and write files in agent memory.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `read` | `(agentId: string, path: string) => Promise<string>` | Read file contents |
| `write` | `(agentId: string, path: string, content: string) => Promise<void>` | Write file contents |
| `append` | `(agentId: string, path: string, content: string) => Promise<void>` | Append to a file |
| `list` | `(agentId: string, path?: string) => Promise<FileEntry[]>` | List files in a directory |
| `delete` | `(agentId: string, path: string) => Promise<void>` | Delete a file |
| `search` | `(agentId: string, pattern: string, path?: string) => Promise<Array<{ path, line }>>` | Search for text pattern |
| `mkdir` | `(agentId: string, path: string) => Promise<void>` | Create a directory |
| `exists` | `(agentId: string, path: string) => Promise<boolean>` | Check if a file exists |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `written` | `{ agentId, path }` | File was written or appended |
| `deleted` | `{ agentId, path }` | File was deleted |

---

### SkillsAPI

Manage agent skills via the engine.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `list` | `(agentId: string) => Promise<SkillMeta[]>` | List skills for an agent |
| `install` | `(agentId: string, skill: SkillMeta) => Promise<SkillMeta>` | Install a skill |
| `remove` | `(agentId: string, skillId: string) => Promise<void>` | Remove a skill |
| `search` | `(query: string) => Promise<SkillSearchResult[]>` | Search for skills |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `installed` | `{ agentId, skill }` | Skill was installed |
| `removed` | `{ agentId, skillId }` | Skill was removed |

---

### TasksAPI

Manage background tasks.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `list` | `(agentId?: string) => Promise<Task[]>` | List tasks |
| `create` | `(task: Omit<Task, 'id' \| 'createdAt' \| 'updatedAt'>) => Promise<Task>` | Create a task |
| `get` | `(taskId: string) => Promise<Task>` | Get a task |
| `cancel` | `(taskId: string) => Promise<void>` | Cancel a task |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `created` | `Task` | Task was created |
| `cancelled` | `{ taskId }` | Task was cancelled |

---

### UsageAPI

Track and query token usage and costs.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `getSummary` | `(since?: string) => Promise<UsageSummary>` | Get aggregated usage summary |
| `getRecords` | `(options?: UsageQueryOptions) => Promise<UsageRecord[]>` | Query raw usage records |
| `record` | `(entry: UsageRecord) => Promise<void>` | Record a usage entry |
| `clear` | `() => Promise<void>` | Clear all usage records |
| `getSpendingLimit` | `(agentId: string) => Promise<number \| null>` | Get spending limit for an agent |
| `setSpendingLimit` | `(agentId: string, limit: number \| null) => Promise<void>` | Set or clear spending limit |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `recorded` | `UsageRecord` | Usage was recorded |

---

### SettingsAPI

Manage application settings and API keys.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `() => Promise<Settings>` | Get current settings |
| `update` | `(updates: Partial<Settings>) => Promise<Settings>` | Update settings |
| `getApiKeys` | `() => Promise<ApiKeys>` | Get stored API keys |
| `setApiKeys` | `(keys: ApiKeys) => Promise<void>` | Set API keys |

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `changed` | `{ key, value }` | A setting was changed |
| `providerChanged` | `{ provider }` | Active provider was changed |

---

## Types

### `AgentMeta`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `name` | `string` | Agent name |
| `role` | `string` | Agent role description |
| `visibility` | `'private' \| 'visible' \| 'open'` | Visibility level |
| `bookmarkFolderId` | `string?` | Associated bookmark folder |
| `createdAt` | `string` | Creation timestamp |
| `enabledTools` | `string[]?` | Explicitly enabled tools |
| `disabledTools` | `string[]?` | Explicitly disabled tools |
| `master` | `boolean?` | Whether this is a master agent |
| `temporary` | `boolean?` | Whether this is a temporary agent |
| `createdBy` | `string?` | Creator identifier |
| `provider` | `string?` | Default provider |
| `model` | `string?` | Default model |

### `AgentDetail`

Extends `AgentMeta` with:

| Field | Type | Description |
|-------|------|-------------|
| `claudeMd` | `string` | CLAUDE.md content |
| `journal` | `string[]` | Journal entries |
| `bookmarks` | `string[]` | Bookmarks |

### `AgentModelConfig`

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `string` | Provider name |
| `model` | `string` | Model identifier |
| `apiKey` | `string` | API key |

### `Settings`

| Field | Type | Description |
|-------|------|-------------|
| `defaultAgentId` | `string?` | Default agent ID |
| `activeProvider` | `string` | Active AI provider |
| `theme` | `'dark' \| 'light' \| 'system'` | UI theme |
| `model` | `string?` | Default model |

### `ApiKeys`

```typescript
{ [provider: string]: string | undefined }
```

### `Hook`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Hook identifier |
| `agentId` | `string` | Associated agent |
| `trigger` | `HookTrigger` | Trigger condition |
| `prompt` | `string` | Prompt to send when triggered |
| `description` | `string` | Human-readable description |
| `enabled` | `boolean` | Whether the hook is active |
| `createdAt` | `string` | Creation timestamp |
| `lastTriggeredAt` | `string?` | Last trigger timestamp |
| `triggerCount` | `number` | Number of times triggered |

### `HookTrigger`

Discriminated union with these trigger types:

| Type | Extra Fields | Description |
|------|-------------|-------------|
| `bookmark-created` | `folderId?`, `folderName?` | Bookmark was created |
| `tab-navigated` | `urlPattern` | Tab navigated to URL |
| `tab-created` | -- | New tab was created |
| `tab-closed` | -- | Tab was closed |
| `download-completed` | `filenamePattern?` | Download finished |
| `history-visited` | `urlPattern` | URL visited in history |
| `idle-changed` | `state` | System idle state changed |
| `browser-startup` | -- | Browser started |
| `omnibox` | `keyword` | Omnibox keyword entered |
| `reading-list-changed` | -- | Reading list modified |
| `window-created` | -- | Window created |
| `window-focused` | -- | Window gained focus |
| `window-closed` | -- | Window closed |
| `context-menu` | `label` | Context menu item clicked |
| `clipboard-changed` | -- | Clipboard content changed |
| `filesystem-changed` | `path?` | Filesystem change detected |

### `ChannelConfig`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Channel identifier |
| `name` | `string?` | Channel name |
| `type` | `string` | Channel type |
| `direction` | `'inbound' \| 'bidirectional'` | Message direction |
| `prompt` | `string?` | System prompt for channel |
| `agentId` | `string` | Associated agent |
| `enabled` | `boolean` | Whether channel is active |
| `metadata` | `Record<string, unknown>` | Additional metadata |

### `ChannelMessage`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Message identifier |
| `channelType` | `string` | Channel type |
| `channelId` | `string` | Channel identifier |
| `from` | `string` | Sender |
| `content` | `string` | Message content |
| `timestamp` | `string` | Timestamp |
| `metadata` | `Record<string, unknown>?` | Additional metadata |

### `Task`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Task identifier |
| `subject` | `string` | Task subject |
| `description` | `string?` | Task description |
| `owner` | `string?` | Task owner |
| `status` | `'pending' \| 'in_progress' \| 'completed' \| 'failed'` | Status |
| `blockedBy` | `string[]?` | IDs of blocking tasks |
| `result` | `string?` | Task result |
| `createdAt` | `string` | Creation timestamp |
| `updatedAt` | `string` | Last update timestamp |

### `ArtifactMeta`

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Agent identifier |
| `path` | `string` | Artifact path |
| `description` | `string` | Description |
| `timestamp` | `string` | Creation timestamp |

### `Conversation`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Conversation identifier |
| `agentId` | `string` | Agent identifier |
| `timestamp` | `string` | Timestamp |
| `messages` | `ConversationMessage[]` | Messages |

### `ConversationMessage`

| Field | Type | Description |
|-------|------|-------------|
| `role` | `'user' \| 'assistant' \| 'system'` | Message role |
| `content` | `string` | Message content |
| `timestamp` | `string` | Timestamp |
| `progress` | `ProgressEntry[]?` | Progress entries |

### `ProgressEntry`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'step-start' \| 'tool-call' \| 'tool-result' \| 'thinking' \| 'text'` | Entry type |
| `stepNumber` | `number?` | Step number |
| `toolName` | `string?` | Tool name |
| `toolArgs` | `unknown?` | Tool arguments |
| `toolResult` | `unknown?` | Tool result |
| `content` | `string?` | Text content |
| `timestamp` | `string` | Timestamp |

### `ProgressUpdate`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'thinking' \| 'tool-call' \| 'tool-result' \| 'text' \| 'step-complete' \| 'done' \| 'error'` | Update type |
| `content` | `string` | Content |
| `toolName` | `string?` | Tool name |
| `toolArgs` | `unknown?` | Tool arguments |
| `toolResult` | `unknown?` | Tool result |
| `iteration` | `number?` | Current iteration |
| `totalIterations` | `number?` | Total iterations |

### `ChatOptions`

| Field | Type | Description |
|-------|------|-------------|
| `pageContext` | `{ title, url, content }?` | Page context |
| `columnId` | `string?` | Column identifier |

### `AgenticOptions`

Extends `ChatOptions` with:

| Field | Type | Description |
|-------|------|-------------|
| `maxIterations` | `number?` | Max agent iterations |
| `source` | `'chat' \| 'hook' \| 'channel' \| 'task' \| 'message'?` | Message source |

### `UsageRecord` (SDK)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Record identifier |
| `timestamp` | `string` | Timestamp |
| `agentId` | `string` | Agent identifier |
| `agentName` | `string` | Agent name |
| `provider` | `string` | Provider name |
| `model` | `string` | Model identifier |
| `inputTokens` | `number` | Input tokens |
| `outputTokens` | `number` | Output tokens |
| `totalTokens` | `number` | Total tokens |
| `estimatedCost` | `number` | Estimated cost in USD |
| `source` | `'chat' \| 'hook' \| 'channel' \| 'task' \| 'message' \| 'refine'` | Usage source |

### `UsageSummary`

| Field | Type | Description |
|-------|------|-------------|
| `totalCost` | `number` | Total cost |
| `totalInputTokens` | `number` | Total input tokens |
| `totalOutputTokens` | `number` | Total output tokens |
| `totalRequests` | `number` | Total requests |
| `byProvider` | `Record<string, { cost, inputTokens, outputTokens, requests }>` | Breakdown by provider |
| `byAgent` | `Record<string, { name, cost, inputTokens, outputTokens, requests }>` | Breakdown by agent |
| `byModel` | `Record<string, { cost, inputTokens, outputTokens, requests }>` | Breakdown by model |

### `UsageQueryOptions`

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string?` | Filter by agent |
| `provider` | `string?` | Filter by provider |
| `since` | `string?` | Filter by timestamp |
| `limit` | `number?` | Max records |

### `SkillMeta`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Skill identifier |
| `name` | `string` | Skill name |
| `description` | `string` | Skill description |
| `author` | `string?` | Author |
| `version` | `string?` | Version |
| `source` | `string?` | Source URL |
| `installedAt` | `string` | Install timestamp |
| `files` | `string[]` | Skill file paths |

### `SkillSearchResult`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Skill identifier |
| `name` | `string` | Skill name |
| `description` | `string` | Description |
| `author` | `string?` | Author |
| `source` | `string` | Source |
| `url` | `string` | URL |

### `FileEntry`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | File or directory name |
| `type` | `'file' \| 'directory'` | Entry type |

### `PaginationOptions`

| Field | Type | Description |
|-------|------|-------------|
| `limit` | `number?` | Max results |
| `cursor` | `string?` | Pagination cursor |
| `since` | `string?` | Filter by timestamp |

---

## Store Interfaces

All stores are async and can be backed by any storage backend (IndexedDB, filesystem, database, etc.). In-memory implementations are provided for development and testing.

### `SettingsStore`

| Method | Signature |
|--------|-----------|
| `get<T>` | `(key: string) => Promise<T \| undefined>` |
| `set` | `(key: string, value: unknown) => Promise<void>` |
| `remove` | `(key: string) => Promise<void>` |
| `getMultiple<T>` | `(keys: string[]) => Promise<Record<string, T>>` |

### `MemoryStore`

| Method | Signature |
|--------|-----------|
| `read` | `(agentId: string, path: string) => Promise<string>` |
| `write` | `(agentId: string, path: string, content: string) => Promise<void>` |
| `append` | `(agentId: string, path: string, content: string) => Promise<void>` |
| `delete` | `(agentId: string, path: string) => Promise<void>` |
| `list` | `(agentId: string, path?: string) => Promise<FileEntry[]>` |
| `mkdir` | `(agentId: string, path: string) => Promise<void>` |
| `exists` | `(agentId: string, path: string) => Promise<boolean>` |
| `search` | `(agentId: string, pattern: string, path?: string) => Promise<Array<{ path, line }>>` |

### `ConversationStore`

| Method | Signature |
|--------|-----------|
| `get` | `(agentId: string, conversationId: string) => Promise<Conversation \| undefined>` |
| `list` | `(agentId: string) => Promise<Array<{ id, timestamp }>>` |
| `save` | `(agentId: string, conversation: Conversation) => Promise<void>` |
| `delete` | `(agentId: string, conversationId: string) => Promise<void>` |

### `HookStore`

| Method | Signature |
|--------|-----------|
| `list` | `(agentId?: string) => Promise<Hook[]>` |
| `get` | `(hookId: string) => Promise<Hook \| undefined>` |
| `add` | `(hook: Hook) => Promise<void>` |
| `update` | `(hookId: string, updates: Partial<Hook>) => Promise<void>` |
| `remove` | `(hookId: string) => Promise<void>` |

### `UsageStore`

| Method | Signature |
|--------|-----------|
| `record` | `(entry: UsageRecord) => Promise<void>` |
| `query` | `(options?: UsageQueryOptions) => Promise<UsageRecord[]>` |
| `clear` | `() => Promise<void>` |

### `AgentStore`

| Method | Signature |
|--------|-----------|
| `list` | `() => Promise<AgentMeta[]>` |
| `get` | `(agentId: string) => Promise<AgentMeta \| undefined>` |
| `add` | `(agent: AgentMeta) => Promise<void>` |
| `update` | `(agentId: string, updates: Partial<AgentMeta>) => Promise<void>` |
| `remove` | `(agentId: string) => Promise<void>` |

---

## In-Memory Store Implementations

Exported from `@chaos/sdk/stores/in-memory`:

| Class | Implements | Description |
|-------|------------|-------------|
| `InMemorySettingsStore` | `SettingsStore` | Map-backed key-value store |
| `InMemoryMemoryStore` | `MemoryStore` | In-memory virtual filesystem |
| `InMemoryConversationStore` | `ConversationStore` | Map-backed conversation store |
| `InMemoryHookStore` | `HookStore` | Map-backed hook store |
| `InMemoryUsageStore` | `UsageStore` | Array-backed usage store |
| `InMemoryAgentStore` | `AgentStore` | Map-backed agent store |

---

## Connection Interfaces

Exported from `@chaos/sdk/connections`:

### `EngineConnection`

| Method | Signature | Description |
|--------|-----------|-------------|
| `send` | `(message: ApiMessage) => Promise<ApiResponse>` | Send a request and get a response |
| `stream` | `(message: ApiMessage) => AsyncIterable<ApiEvent>` | Stream events from the engine |
| `subscribe` | `(event: string, handler: (data: unknown) => void) => () => void` | Subscribe to events (returns unsubscribe function) |
| `disconnect` | `() => void` | Disconnect from the engine |

### `RelayConnection`

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `() => Promise<{ userId, apiKey }>` | Register with the relay |
| `fetch` | `(path: string, options?: RequestInit) => Promise<Response>` | Make an authenticated fetch |
| `connect` | `() => Promise<{ close(), onMessage(handler) }>` | Open a persistent connection |

### `ApiMessage`

```typescript
{ type: string; [key: string]: unknown }
```

### `ApiResponse`

```typescript
{ [key: string]: unknown }
```

### `ApiEvent`

```typescript
{ type: string; [key: string]: unknown }
```

---

## Browser Capabilities

Exported from `@chaos/sdk/browser`:

### `BrowserCapabilities`

Optional browser APIs for browser-extension environments.

| Property | Type | Description |
|----------|------|-------------|
| `tabs` | `TabsAPI?` | Tab management |
| `bookmarks` | `BookmarksAPI?` | Bookmark management |
| `history` | `HistoryAPI?` | History search |
| `notifications` | `NotificationsAPI?` | Desktop notifications |
| `clipboard` | `ClipboardAPI?` | Clipboard access |

#### TabsAPI

| Method | Signature |
|--------|-----------|
| `list` | `() => Promise<TabInfo[]>` |
| `read` | `(tabId: string) => Promise<string>` |
| `open` | `(url: string) => Promise<TabInfo>` |
| `close` | `(tabId: string) => Promise<void>` |
| `focus` | `(tabId: string) => Promise<void>` |
| `navigate` | `(tabId: string, url: string) => Promise<void>` |

#### BookmarksAPI

| Method | Signature |
|--------|-----------|
| `search` | `(query: string) => Promise<BookmarkInfo[]>` |
| `list` | `(folderId?: string) => Promise<BookmarkInfo[]>` |
| `add` | `(url: string, title: string, folderId?: string) => Promise<BookmarkInfo>` |
| `remove` | `(id: string) => Promise<void>` |

#### HistoryAPI

| Method | Signature |
|--------|-----------|
| `search` | `(query: string, maxResults?: number) => Promise<HistoryItem[]>` |

#### NotificationsAPI

| Method | Signature |
|--------|-----------|
| `show` | `(title: string, message: string, options?: { iconUrl? }) => Promise<void>` |

#### ClipboardAPI

| Method | Signature |
|--------|-----------|
| `write` | `(text: string) => Promise<void>` |
| `read` | `() => Promise<string>` |

### `TabInfo`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Tab identifier |
| `url` | `string` | Tab URL |
| `title` | `string` | Tab title |
| `active` | `boolean` | Whether the tab is active |

### `BookmarkInfo`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Bookmark identifier |
| `url` | `string` | Bookmark URL |
| `title` | `string` | Bookmark title |
| `dateAdded` | `number?` | Date added (ms since epoch) |

### `HistoryItem`

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | URL |
| `title` | `string` | Page title |
| `lastVisitTime` | `number?` | Last visit time (ms since epoch) |
