# @chaos/sdk

SDK for building AI agent applications. Provides a unified API surface for managing agents, conversations, files, hooks, skills, tasks, usage tracking, and settings -- with pluggable store backends and optional browser/extension integration.

## Features

- **Domain APIs** -- agents, chat, files, hooks, skills, tasks, channels, artifacts, usage, settings
- **Pluggable stores** -- 6 store interfaces with in-memory reference implementations included
- **Streaming chat** -- `sendMessage()` returns `AsyncIterable<ProgressUpdate>` for real-time progress
- **Agent registration** -- register `@chaos/agent-loop` agents for direct in-process execution
- **Event-driven** -- every domain API extends `EventTarget` for reactive UIs
- **Connection abstractions** -- `EngineConnection` for Chrome extension transport, `RelayConnection` for relay servers
- **Browser capabilities** -- optional abstraction over Chrome tabs, bookmarks, history, notifications, clipboard
- **In-memory stores** -- full reference implementations for testing and prototyping

## Install

```bash
npm install @chaos/sdk
```

## Quick Start

```ts
import { ChaosSDK } from '@chaos/sdk';
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '@chaos/sdk/stores/in-memory';
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

// Create an agent
const agent = createAgent({
  id: 'assistant',
  name: 'Assistant',
  model: createMockModel({
    responses: [{ text: 'Hello! How can I help?' }],
  }),
});

// Initialize the SDK with in-memory stores
const sdk = new ChaosSDK({
  settings: new InMemorySettingsStore(),
  memory: new InMemoryMemoryStore(),
  conversations: new InMemoryConversationStore(),
  hooks: new InMemoryHookStore(),
  usage: new InMemoryUsageStore(),
  agentStore: new InMemoryAgentStore(),
  agents: [agent],
});

// Send a message and stream the response
for await (const update of sdk.chat.sendMessage('assistant', 'Hi there')) {
  switch (update.type) {
    case 'text':
      console.log(update.content);
      break;
    case 'done':
      console.log('Complete:', update.content);
      break;
  }
}
```

## Architecture

```
ChaosSDK
  |
  |-- agents    (AgentsAPI)     -- CRUD for agent metadata
  |-- chat      (ChatAPI)       -- send messages, stream responses, manage conversations
  |-- files     (FilesAPI)      -- read/write/search files via MemoryStore
  |-- hooks     (HooksAPI)      -- event-driven triggers (bookmark, tab, download, etc.)
  |-- skills    (SkillsAPI)     -- install/search/remove agent skills
  |-- tasks     (TasksAPI)      -- create and track async tasks
  |-- channels  (ChannelsAPI)   -- external messaging channels
  |-- artifacts (ArtifactsAPI)  -- agent-produced file artifacts
  |-- usage     (UsageAPI)      -- token/cost tracking and spending limits
  |-- settings  (SettingsAPI)   -- app settings, API keys, provider config
  |
  |-- Stores (pluggable)
  |     |-- SettingsStore       -- key-value settings
  |     |-- MemoryStore         -- file system abstraction
  |     |-- ConversationStore   -- conversation history
  |     |-- HookStore           -- hook definitions
  |     |-- UsageStore          -- usage records
  |     |-- AgentStore          -- agent metadata
  |
  |-- Connections (optional)
  |     |-- EngineConnection    -- Chrome extension message transport
  |     |-- RelayConnection     -- relay server for external channels
  |
  |-- BrowserCapabilities (optional)
        |-- tabs, bookmarks, history, notifications, clipboard
```

## Agents

Register `@chaos/agent-loop` agents for in-process execution, or use an `EngineConnection` for remote agent management.

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

// Register at construction
const sdk = new ChaosSDK({
  // ... stores ...
  agents: [agent1, agent2],
});

// Or register later
const agent3 = createAgent({
  id: 'researcher',
  name: 'Researcher',
  model: createMockModel({ responses: [{ text: 'Research complete.' }] }),
});
sdk.chat.registerAgent(agent3);
sdk.chat.unregisterAgent('researcher');
```

Agent metadata (name, role, visibility, model config) is stored in the `AgentStore`:

```ts
// List agents from the store
const agents = await sdk.agents.list();

// Get agent details
const agent = await sdk.agents.get('assistant');

// Update metadata
await sdk.agents.update('assistant', { name: 'My Assistant' });

// Agent CLAUDE.md (system prompt)
const claudeMd = await sdk.agents.getClaudeMd('assistant');
await sdk.agents.setClaudeMd('assistant', '# New system prompt');
```

## Chat

### sendMessage()

`sendMessage()` routes to a registered in-process agent if available, otherwise falls back to the `EngineConnection`:

```ts
for await (const update of sdk.chat.sendMessage('assistant', 'Summarize this page', {
  pageContext: { title: 'Page', url: 'https://example.com', content: '...' },
  maxIterations: 10,
})) {
  console.log(update.type, update.content);
}
```

### ProgressUpdate types

| Type | Fields | Description |
|------|--------|-------------|
| `thinking` | `content` | Model is thinking/streaming |
| `text` | `content` | Text output |
| `tool-call` | `toolName`, `toolArgs` | Model is calling a tool |
| `tool-result` | `toolName`, `toolResult` | Tool returned a result |
| `step-complete` | `iteration` | A loop step finished |
| `done` | `content` | Agent completed the task |
| `error` | `content` | An error occurred |

### Stopping

```ts
await sdk.chat.stop('assistant');
```

### Conversations

```ts
const convos = await sdk.chat.listConversations('assistant');
const convo = await sdk.chat.getConversation('assistant', convos[0].id);
await sdk.chat.deleteConversation('assistant', convos[0].id);
```

## Stores

The SDK requires 6 store implementations. All are interfaces -- implement them with any backend (IndexedDB, SQLite, Postgres, filesystem, KV store).

### Store Interfaces

```ts
import type {
  SettingsStore,
  MemoryStore,
  ConversationStore,
  HookStore,
  UsageStore,
  AgentStore,
} from '@chaos/sdk/stores';
```

| Store | Purpose | Key Methods |
|-------|---------|-------------|
| `SettingsStore` | Key-value settings | `get<T>(key)`, `set(key, value)`, `remove(key)`, `getMultiple(keys)` |
| `MemoryStore` | Virtual file system | `read`, `write`, `append`, `delete`, `list`, `mkdir`, `exists`, `search` |
| `ConversationStore` | Chat history | `get(agentId, id)`, `list(agentId)`, `save(agentId, convo)`, `delete` |
| `HookStore` | Event triggers | `list(agentId?)`, `get(id)`, `add(hook)`, `update(id, updates)`, `remove(id)` |
| `UsageStore` | Token/cost records | `record(entry)`, `query(options?)`, `clear()` |
| `AgentStore` | Agent metadata | `list()`, `get(id)`, `add(agent)`, `update(id, updates)`, `remove(id)` |

### Implementing a custom store

```ts
import type { MemoryStore } from '@chaos/sdk/stores';
import type { FileEntry } from '@chaos/sdk';

class PostgresMemoryStore implements MemoryStore {
  async read(agentId: string, path: string): Promise<string> {
    const row = await db.query('SELECT content FROM files WHERE agent_id = $1 AND path = $2', [agentId, path]);
    if (!row) throw new Error(`File not found: ${path}`);
    return row.content;
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    await db.query('INSERT INTO files (agent_id, path, content) VALUES ($1, $2, $3) ON CONFLICT DO UPDATE SET content = $3', [agentId, path, content]);
  }

  async append(agentId: string, path: string, content: string): Promise<void> { /* ... */ }
  async delete(agentId: string, path: string): Promise<void> { /* ... */ }
  async list(agentId: string, path?: string): Promise<FileEntry[]> { /* ... */ }
  async mkdir(agentId: string, path: string): Promise<void> { /* ... */ }
  async exists(agentId: string, path: string): Promise<boolean> { /* ... */ }
  async search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>> { /* ... */ }
}
```

## In-Memory Stores

Reference implementations for testing and prototyping. All 6 stores have in-memory versions:

```ts
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '@chaos/sdk/stores/in-memory';
```

These are fully functional implementations backed by `Map` objects. Use them for unit tests, local development, or as reference when implementing custom stores.

## Connections

Connections are optional transport layers for communicating with remote agent engines.

### EngineConnection

Used for Chrome extension message passing or similar request/response + streaming transports:

```ts
import type { EngineConnection } from '@chaos/sdk/connections';

const engine: EngineConnection = {
  send(message) { /* send and await response */ },
  stream(message) { /* return AsyncIterable of events */ },
  subscribe(event, handler) { /* return unsubscribe function */ },
  disconnect() { /* cleanup */ },
};

const sdk = new ChaosSDK({
  engine,
  // ... stores ...
});
```

### RelayConnection

For external relay servers that bridge agents to external services:

```ts
import type { RelayConnection } from '@chaos/sdk/connections';

const relay: RelayConnection = {
  register() { /* returns { userId, apiKey } */ },
  fetch(path, options?) { /* HTTP requests to relay */ },
  connect() { /* WebSocket: returns { close(), onMessage(handler) } */ },
};

const sdk = new ChaosSDK({
  relay,
  // ... stores ...
});
```

## Browser Capabilities

Optional abstraction over browser/Chrome APIs. Pass it to the SDK to enable browser-aware agent tools:

```ts
import type { BrowserCapabilities } from '@chaos/sdk/browser';

const browser: BrowserCapabilities = {
  tabs: {
    list: () => chrome.tabs.query({}),
    read: (tabId) => /* inject content script and get page text */,
    open: (url) => chrome.tabs.create({ url }),
    close: (tabId) => chrome.tabs.remove(Number(tabId)),
    focus: (tabId) => chrome.tabs.update(Number(tabId), { active: true }),
    navigate: (tabId, url) => chrome.tabs.update(Number(tabId), { url }),
  },
  bookmarks: {
    search: (query) => chrome.bookmarks.search(query),
    list: (folderId?) => chrome.bookmarks.getChildren(folderId ?? '0'),
    add: (url, title, folderId?) => chrome.bookmarks.create({ url, title, parentId: folderId }),
    remove: (id) => chrome.bookmarks.remove(id),
  },
  history: {
    search: (query, maxResults?) => chrome.history.search({ text: query, maxResults }),
  },
  notifications: {
    show: (title, message, options?) => chrome.notifications.create({ type: 'basic', title, message, ...options }),
  },
  clipboard: {
    write: (text) => navigator.clipboard.writeText(text),
    read: () => navigator.clipboard.readText(),
  },
};
```

All capability groups are optional -- provide only what your environment supports.

## Events

Every domain API extends `EventTarget`. Use standard `addEventListener` for reactive updates:

```ts
// Chat events
sdk.chat.addEventListener('chunk', (e) => {
  const { agentId, chunk } = (e as CustomEvent).detail;
  console.log(`${agentId}: ${chunk}`);
});

sdk.chat.addEventListener('toolCall', (e) => {
  const { agentId, toolName, args } = (e as CustomEvent).detail;
});

sdk.chat.addEventListener('done', (e) => {
  const { agentId, result } = (e as CustomEvent).detail;
});

// Agent events
sdk.agents.addEventListener('created', (e) => { /* ... */ });
sdk.agents.addEventListener('updated', (e) => { /* ... */ });
sdk.agents.addEventListener('deleted', (e) => { /* ... */ });
sdk.agents.addEventListener('configChanged', (e) => { /* ... */ });
sdk.agents.addEventListener('claudeMdChanged', (e) => { /* ... */ });

// File events
sdk.files.addEventListener('written', (e) => {
  const { agentId, path } = (e as CustomEvent).detail;
});
sdk.files.addEventListener('deleted', (e) => { /* ... */ });

// Hook events
sdk.hooks.addEventListener('created', (e) => { /* ... */ });
sdk.hooks.addEventListener('triggered', (e) => { /* ... */ });
sdk.hooks.addEventListener('enabled', (e) => { /* ... */ });

// Usage events
sdk.usage.addEventListener('recorded', (e) => { /* ... */ });

// Settings events
sdk.settings.addEventListener('changed', (e) => { /* ... */ });
sdk.settings.addEventListener('providerChanged', (e) => { /* ... */ });
```

## Files

The `FilesAPI` provides a virtual file system scoped per agent, backed by the `MemoryStore`:

```ts
// Write a file
await sdk.files.write('agent-1', 'notes/todo.md', '# TODO\n- Buy milk');

// Read it back
const content = await sdk.files.read('agent-1', 'notes/todo.md');

// List directory
const entries = await sdk.files.list('agent-1', 'notes');
// [{ name: 'todo.md', type: 'file' }]

// Search across files
const results = await sdk.files.search('agent-1', 'TODO');
// [{ path: 'notes/todo.md', line: '# TODO' }]

// Check existence
const exists = await sdk.files.exists('agent-1', 'notes/todo.md'); // true

// Append
await sdk.files.append('agent-1', 'notes/todo.md', '\n- Buy eggs');

// Create directories
await sdk.files.mkdir('agent-1', 'notes/archive');

// Delete
await sdk.files.delete('agent-1', 'notes/todo.md');
```

## Hooks

Hooks are event-driven triggers that fire agent actions when browser events occur:

```ts
// Create a hook
await sdk.hooks.create({
  id: 'bookmark-hook',
  agentId: 'assistant',
  trigger: { type: 'bookmark-created' },
  prompt: 'Summarize the bookmarked page',
  description: 'Auto-summarize new bookmarks',
  enabled: true,
  createdAt: new Date().toISOString(),
  triggerCount: 0,
});

// List hooks for an agent
const hooks = await sdk.hooks.list('assistant');

// Trigger a hook manually
await sdk.hooks.trigger('bookmark-hook', { url: 'https://example.com' });

// Disable/enable
await sdk.hooks.update('bookmark-hook', { enabled: false });
```

### Trigger types

`bookmark-created`, `tab-navigated`, `tab-created`, `tab-closed`, `download-completed`, `history-visited`, `idle-changed`, `browser-startup`, `omnibox`, `reading-list-changed`, `window-created`, `window-focused`, `window-closed`, `context-menu`, `clipboard-changed`, `filesystem-changed`.

## Usage

Track token consumption and costs across agents:

```ts
// Record usage
await sdk.usage.record({
  id: 'usage-1',
  timestamp: new Date().toISOString(),
  agentId: 'assistant',
  agentName: 'Assistant',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  estimatedCost: 0.0105,
  source: 'chat',
});

// Get summary
const summary = await sdk.usage.getSummary();
console.log(summary.totalCost, summary.byAgent, summary.byModel);

// Query records
const records = await sdk.usage.getRecords({ agentId: 'assistant', since: '2025-01-01' });

// Spending limits
await sdk.usage.setSpendingLimit('assistant', 10.0); // $10 max
const limit = await sdk.usage.getSpendingLimit('assistant');
```

## Settings

Manage application settings and API keys:

```ts
// Get/update settings
const settings = await sdk.settings.get();
// { activeProvider: 'anthropic', theme: 'system' }

await sdk.settings.update({ activeProvider: 'openai', theme: 'dark' });

// API keys
await sdk.settings.setApiKeys({
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
});
const keys = await sdk.settings.getApiKeys();
```

## Skills

Manage agent skills through the SDK:

```ts
const skills = await sdk.skills.list('assistant');
const results = await sdk.skills.search('code review');
const installed = await sdk.skills.install('assistant', {
  id: 'code-review',
  name: 'Code Review',
  description: 'Reviews code quality',
  installedAt: new Date().toISOString(),
  files: ['SKILL.md'],
});
await sdk.skills.remove('assistant', 'code-review');
```

## Tasks

Track async work items:

```ts
const task = await sdk.tasks.create({
  subject: 'Research competitors',
  description: 'Find and analyze competing products',
  owner: 'assistant',
  status: 'pending',
});

const tasks = await sdk.tasks.list('assistant');
const detail = await sdk.tasks.get(task.id);
await sdk.tasks.cancel(task.id);
```

## Channels

External messaging channels (email, Slack, Discord, etc.):

```ts
const channel = await sdk.channels.register({
  id: 'slack-general',
  type: 'slack',
  direction: 'bidirectional',
  agentId: 'assistant',
  enabled: true,
  metadata: { workspace: 'my-team' },
});

const channels = await sdk.channels.list();
const messages = await sdk.channels.getMessages('slack-general', { limit: 50 });
await sdk.channels.remove('slack-general');
```

## Artifacts

Agent-produced file artifacts:

```ts
const artifacts = await sdk.artifacts.list('assistant');
const artifact = await sdk.artifacts.get('assistant', 'report.pdf');
await sdk.artifacts.delete('assistant', 'report.pdf');
```

## API Reference

### Main exports (`@chaos/sdk`)

| Export | Type | Description |
|--------|------|-------------|
| `ChaosSDK` | class | Main SDK class with all domain APIs |
| `ChaosSDKOptions` | type | Constructor options |
| All types from `types.ts` | types | `AgentMeta`, `Hook`, `Settings`, `Conversation`, `ProgressUpdate`, etc. |

### Store exports (`@chaos/sdk/stores`)

| Export | Type | Description |
|--------|------|-------------|
| `SettingsStore` | interface | Key-value settings storage |
| `MemoryStore` | interface | Virtual file system |
| `ConversationStore` | interface | Conversation history |
| `HookStore` | interface | Hook definitions |
| `UsageStore` | interface | Usage records |
| `AgentStore` | interface | Agent metadata |

### In-memory store exports (`@chaos/sdk/stores/in-memory`)

| Export | Type | Description |
|--------|------|-------------|
| `InMemorySettingsStore` | class | In-memory `SettingsStore` |
| `InMemoryMemoryStore` | class | In-memory `MemoryStore` (virtual filesystem) |
| `InMemoryConversationStore` | class | In-memory `ConversationStore` |
| `InMemoryHookStore` | class | In-memory `HookStore` |
| `InMemoryUsageStore` | class | In-memory `UsageStore` |
| `InMemoryAgentStore` | class | In-memory `AgentStore` |

### Connection exports (`@chaos/sdk/connections`)

| Export | Type | Description |
|--------|------|-------------|
| `EngineConnection` | interface | Request/response + streaming transport |
| `RelayConnection` | interface | Relay server connection |

### Browser exports (`@chaos/sdk/browser`)

| Export | Type | Description |
|--------|------|-------------|
| `BrowserCapabilities` | interface | Optional browser API abstraction |
| `TabInfo` | interface | Tab metadata |
| `BookmarkInfo` | interface | Bookmark metadata |
| `HistoryItem` | interface | History entry |

## License

Apache 2.0
