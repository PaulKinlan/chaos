# CHAOS Architecture

**C**hrome **A**gent **O**perating **S**ystem -- a Chrome extension that runs multiple AI agents in your browser with persistent memory, inter-agent communication, and external channel integration via a relay server.

## Monorepo Structure

```
chaos/
  packages/
    extension/       Chrome extension (Manifest V3, Vite build)
    server/          Relay server (Deno + Deno KV, deployed to Deno Deploy)
    shared/          Shared types (ChannelMessage, ChannelConfig, SkillManifest)
    web/             Web frontend (not yet active)
  docs/              Documentation
  plans/             Planning documents
```

## High-Level Architecture

```
+------------------------------------------------------------------+
|  Chrome Extension (Manifest V3)                                  |
|                                                                  |
|  +------------------+    +-------------------+                   |
|  | app.html (UI)    |    | background.ts     |                   |
|  | - Agent tabs     |<-->| (Service Worker)  |                   |
|  | - Chat columns   |    | - Message routing |                   |
|  | - Task board     |    | - Agent lifecycle |                   |
|  | - Settings       |    | - Alarm handling  |                   |
|  +------------------+    | - Hook listeners  |                   |
|           |              | - Channel polling  |                   |
|           |              +--------+----------+                   |
|           |                       |                              |
|           v                       v                              |
|  +------------------+    +-------------------+                   |
|  | IndexedDB        |    | OPFS              |                   |
|  | - Conversations  |    | - agents/{id}/    |                   |
|  | - Page cache     |    |   CLAUDE.md       |                   |
|  | - Embeddings     |    |   memories/       |                   |
|  | - WASM tools     |    |   activity-log    |                   |
|  +------------------+    |   TODO.md         |                   |
|                          | - shared/         |                   |
|                          |   messages.jsonl  |                   |
|                          |   tasks.jsonl     |                   |
|                          |   artifacts.jsonl |                   |
|                          +-------------------+                   |
+------------------------------------------------------------------+
            |  WebSocket + HTTP polling
            v
+------------------------------------------------------------------+
|  Relay Server (Deno Deploy)                                      |
|                                                                  |
|  +-------------------+    +-------------------+                  |
|  | Deno.serve()      |    | Deno KV           |                  |
|  | - REST API        |<-->| - Sessions        |                  |
|  | - WebSocket       |    | - Messages        |                  |
|  | - Webhook ingest  |    | - Channels        |                  |
|  | - Telegram bridge |    | - Admin sessions  |                  |
|  +-------------------+    +-------------------+                  |
|            |                                                     |
|            v                                                     |
|  +-------------------+    +-------------------+                  |
|  | Webhook channels  |    | Telegram Bot API  |                  |
|  | (inbound POST)    |    | (bidirectional)   |                  |
|  +-------------------+    +-------------------+                  |
+------------------------------------------------------------------+
```

## Extension Architecture

### Entry Points

| File | Role |
|------|------|
| `background.ts` | Service worker. Message routing, alarm handling, hook listeners, channel polling, context menus, agent lifecycle orchestration. |
| `app.ts` / `app.html` | Main dashboard UI. Agent tab bar, chat columns (TweetDeck-style), task board, file browser, settings. Opened on extension icon click. Single-instance enforced via BroadcastChannel. |
| `popup.ts` | Minimal popup (redirects to app.html). |
| `sidepanel.ts` | Side panel interface (alternative to app.html). |
| `content/extractor.ts` | Content script injected into pages. Extracts page content as markdown using Readability + Turndown. |
| `offscreen-parser.ts` | Offscreen document for DOM parsing (Readability) when content scripts are unavailable. |

### Storage

**OPFS (Origin Private File System)** -- primary agent storage:
```
agents/
  {agent-id}/
    CLAUDE.md              Agent personality and instructions (self-editable)
    activity-log.jsonl     Append-only activity journal
    TODO.md                Task list
    memories/              Topic-specific memory files
    people/                Notes about people
    ideas/                 Idea captures
    bookmarks/             Cached page content
    conversations/         Conversation history
    skills/                Installed skill files
      {skill-id}/
        SKILL.md           Skill instructions
        reference/         Supporting reference files

shared/
  messages.jsonl           Inter-agent message bus (append-only JSONL)
  tasks.jsonl              Task board events (event-sourced JSONL)
  artifacts.jsonl          Artifact registry (published files)
  artifacts/               Artifact file content
```

**Chrome Storage** -- metadata and settings:
- `chrome.storage.sync`: Settings (active provider, theme, model)
- `chrome.storage.local`: API keys, agent list (AgentMeta[]), scheduled tasks, hooks, tool permissions

**IndexedDB** -- structured data:
- Conversations (message history with progress entries)
- Page cache (extracted content)
- Embeddings (vector cache for semantic tool lookup)
- WASM tool binaries

### Service Worker Lifecycle

```
chrome.runtime.onInstalled
  |
  +-> Create default master agent (on fresh install)
  +-> Setup context menus
  +-> Register content scripts
  +-> Reload NTP tabs (on update)

chrome.runtime.onStartup
  +-> Register content scripts

Always running:
  +-> initHooksListeners() -- registers Chrome event listeners for all hooks
  +-> setMessageNotifier() -- wires inter-agent message delivery
  +-> setTaskExecutor()    -- wires assign_task -> agentic loop execution
```

## Agent System

### Agent Metadata (`AgentMeta`)

```typescript
interface AgentMeta {
  id: string;              // "agent-{timestamp}-{random}"
  name: string;
  role: string;            // neutral | researcher | coder | writer | planner | reviewer | master
  visibility: 'private' | 'visible' | 'open';
  master?: boolean;        // true for the master agent
  temporary?: boolean;     // true for master-created throwaway agents
  createdBy?: string;      // agentId of creating master
  enabledTools?: string[]; // whitelist (if set, only these tools)
  disabledTools?: string[];// blacklist
  bookmarkFolderId?: string;
  createdAt: string;
}
```

### Role Templates

Each role gets a distinct CLAUDE.md generated from `agents/templates/`:

| Role | Purpose |
|------|---------|
| `master` | Primary user-facing agent. Orchestrates sub-agents, delegates tasks, manages the agent ecosystem. |
| `neutral` | General-purpose agent. Fallback template. |
| `researcher` | Deep-dive research, web searches, data gathering. |
| `coder` | Code writing, debugging, technical implementation. |
| `writer` | Content creation, editing, drafting. |
| `planner` | Project planning, task breakdown, scheduling. |
| `reviewer` | Code review, content review, quality checks. |

### Agent Loop (`loop.ts`)

The single-turn chat loop, used for interactive conversations:

```
User message
  |
  v
Read agent's CLAUDE.md from OPFS
  |
  v
Build system prompt (CLAUDE.md + skills + activity log + pending messages + page context)
  |
  v
Assemble tool set (file tools + chrome + web + communication + hooks + master + skills + wasm)
  |
  v
Filter tools by agent config (enabledTools / disabledTools)
  |
  v
Wrap tools with permission checks
  |
  v
streamText() with stepCountIs(10) -- multi-step within a single turn
  |
  v
Stream response chunks to UI via port.postMessage
  |
  v
Append to activity-log.jsonl
```

### Agentic Loop (`agentic-loop.ts`)

The autonomous multi-turn loop, used for scheduled tasks, hooks, context menu actions, and delegated work:

```
Task prompt
  |
  v
[Same setup as agent loop: CLAUDE.md, tools, permissions]
  |
  v
for i in 0..maxIterations (default 20):
  |
  +-> streamText() with stepCountIs(5) inner steps
  |     |
  |     +-> Stream text deltas to onProgress callback
  |     +-> Collect tool calls and results
  |
  +-> If no tool calls in this iteration -> task complete, return text
  |
  +-> Otherwise, append response to message history
  |     and add "Continue working" user message
  |
  v
Hit max iterations -> return last text
```

### Tool System

Tools are assembled per-agent from multiple categories and wrapped in two layers:

1. **Permission layer**: Checks `chrome.storage.local` for per-tool permission (always/ask/never)
2. **Config filter**: Applies agent's `enabledTools`/`disabledTools` whitelist/blacklist

Every agent gets these built-in file tools operating on its OPFS directory:
- `read_file`, `write_file`, `edit_file`, `append_file`, `delete_file`, `rename_file`
- `list_directory`, `mkdir`, `grep_file`, `find_files`, `file_info`

### Tool Lookup

Three strategies for resolving which tools to include:

| Strategy | Implementation | Behavior |
|----------|---------------|----------|
| `static` | `StaticLookup` | Returns all registered tools (default) |
| `keyword` | `KeywordLookup` | TF-IDF style keyword matching against tool descriptions |
| `embedding` | `EmbeddingLookup` | Semantic similarity via API-based text embeddings (OpenAI text-embedding-3-small) |

## Inter-Agent Communication

### Message Bus

Agents communicate via a shared append-only JSONL file at `shared/messages.jsonl`:

```
Agent A                                  Agent B
  |                                        |
  +-> message_send(to: B, body: "...")     |
  |     |                                  |
  |     +-> appendMessage() to JSONL       |
  |     +-> messageNotifier callback       |
  |           |                            |
  |           +-> background.ts            |
  |                 |                      |
  |                 +-> Notify UI          |
  |                 +-> Wake agent B       |
  |                       |                |
  |                       +-> runAgenticLoop(B, "new message from A")
  |                                        |
  |                     message_read() <---+
```

Messages can be point-to-point (`to: "agent-123"`) or broadcast (`to: "broadcast"`).

### Task Board

Event-sourced task management via `shared/tasks.jsonl`:

```typescript
interface Task {
  id: string;
  subject: string;
  description?: string;
  owner?: string;          // assigned agent ID
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  blockedBy?: string[];    // dependency task IDs
  result?: string;
}
```

When a task completes, the system checks for newly unblocked downstream tasks and triggers their assigned agents via Chrome alarms.

### Artifacts

Shared file publishing via `shared/artifacts.jsonl` + `shared/artifacts/`:

```
Agent A writes research/report.md in its private OPFS
  |
  +-> artifact_publish(path: "research/report.md", description: "...")
        |
        +-> Copy content to shared/artifacts/{agentA-id}/research/report.md
        +-> Append metadata to shared/artifacts.jsonl
        |
Agent B can now:
  +-> artifact_list() to discover it
  +-> artifact_read(path) to read the content
```

## Relay Server

### Architecture

The relay server bridges external channels (webhooks, Telegram) to the Chrome extension. It runs on Deno Deploy with Deno KV for persistence.

```
External Source           Relay Server              Extension
     |                        |                        |
     +-- POST /webhook/id --> |                        |
     |                        +-> Store in KV          |
     |                        +-> kv.watch() triggers  |
     |                        +-> Push via WebSocket ->|
     |                        |                        +-> runAgenticLoop()
     |                        |                        |
     |                        |   <-- WS reply --------+
     |                        +-> Route reply          |
     |   <-- Telegram API --- +   (e.g. sendMessage)   |
```

### Connection Model

The extension connects to the relay via two complementary paths:

1. **WebSocket** (fast path): Persistent connection at `GET /ws?token={apiKey}`. Server uses `kv.watch()` to push new messages instantly. The WS also carries replies from the extension back to the server.

2. **Alarm polling** (reliable fallback): Chrome alarm fires every 1 minute (5 minutes when WS is connected). Calls `GET /messages?since={timestamp}` to catch anything the WS missed.

### Authentication

- **Registration**: `POST /auth/register` with optional ECDSA P-256 public key. Returns `{ userId, apiKey, serverPublicKey }`.
- **API auth**: `Authorization: Bearer {apiKey}` header on all authenticated endpoints.
- **Request signing** (optional): ECDSA-SHA256 signature in `X-Timestamp`, `X-Nonce`, `X-Signature` headers. Server verifies if present.
- **Webhook auth**: URL-based token (`/webhook/{channelId}?token={secret}`), no Bearer header.
- **Admin auth**: Session cookie (`chaos_admin`) after password login via `CHAOS_ADMIN_KEY` env var.

### Channel Types

| Type | Direction | Auth | Integration |
|------|-----------|------|-------------|
| `webhook` | Inbound only | URL token | Any HTTP client POSTs JSON |
| `telegram` | Bidirectional | Bot token + webhook secret | Telegram Bot API, pairing code flow |
| `discord` | Bidirectional | (planned) | -- |
| `email` | Bidirectional | (planned) | -- |
| `slack` | Bidirectional | (planned) | -- |

## Data Flow Diagrams

### User Chat -> Agent Loop -> Tool Execution

```
User types message in app.html chat column
  |
  v
app.ts sends via chrome.runtime.Port
  |
  v
background.ts receives on port.onMessage
  |
  v
runAgentLoop(agentId, userMessage, pageContext)
  |
  v
loop.ts:
  1. Read CLAUDE.md from OPFS
  2. Build system prompt (CLAUDE.md + skills + journal + messages)
  3. Assemble tools (file + chrome + web + comm + hooks + master + skills + wasm)
  4. Filter by agent config, wrap with permissions
  5. streamText(model, system, messages, tools)
       |
       +-> LLM decides to call tab_list
       |     +-> chrome.tabs.query({})
       |     +-> Returns tab data to LLM
       |
       +-> LLM decides to call write_file
       |     +-> opfs.writeFile(agentRoot/path, content)
       |     +-> Returns confirmation to LLM
       |
       +-> LLM produces final text response
  6. Stream text chunks back via port.postMessage
  7. Append to activity-log.jsonl
  |
  v
app.ts renders markdown response in chat column
```

### Webhook -> Relay -> Extension -> Agent

```
External service POSTs to /webhook/{channelId}?token={secret}
  |
  v
Relay server (main.ts):
  1. Validate channel ID and webhook secret
  2. Rate limit check (60/min per channel)
  3. handleWebhook() -> sanitize content, store as ChannelMessage in KV
  4. Set kv key ["last_message", userId] to trigger watch
  |
  v
kv.watch() fires in startKvWatch():
  1. Read full message from KV
  2. Push via WebSocket: { type: "message", message: {...} }
  |
  v
Extension ws-client.ts receives WS message:
  1. Parse JSON, extract ChannelMessage
  2. Call messageHandler (set by background.ts)
  |
  v
background.ts processChannelMessage():
  1. Find channel config for this channelId
  2. Build prompt with channel context and channel-specific instructions
  3. runAgenticLoop(agentId, prompt)
  4. If agent returns a response, send reply via WS or POST /reply
  |
  v
Relay server routes reply:
  - Webhook channels: store response for polling via GET /responses/{channelId}
  - Telegram channels: call Telegram Bot API sendMessage
```

### Master Agent -> Assign Task -> Sub-Agent -> Completion

```
User asks master agent to do complex research
  |
  v
Master agent (in its loop) decides to delegate:
  1. agent_discover() -> list available agents
  2. find_agent(role: "researcher") -> check for existing researcher
  3. create_agent(name, role, purpose) [if none exists]
  4. artifact_publish(path, description) [publish any needed context]
  5. assign_task(agentId, description, prompt)
       |
       v
  assign-task.ts:
    1. Create task in shared/tasks.jsonl
    2. Trigger taskExecutor callback in background.ts
         |
         v
  background.ts executeAssignedTask():
    1. Read task from shared state
    2. runAgenticLoop(subAgentId, taskPrompt)
         |
         v
  Sub-agent runs autonomously:
    - Uses its own tools and OPFS storage
    - Can read artifacts, communicate via messages
    - Updates task status via task_update
         |
         v
  On completion:
    1. task_update(taskId, status: "completed", result: "...")
    2. message_send(to: masterAgentId, body: "Task complete: ...")
    3. Check for newly unblocked downstream tasks
         |
         v
  Master agent sees message on next interaction or wake-up
    1. message_read() -> finds completion message
    2. Presents results to user
```

## Hooks System

Hooks are event-driven agent triggers. When a Chrome event fires, matching hooks execute the agent's agentic loop with a contextual prompt.

### Supported Triggers

| Trigger | Chrome API | Filter |
|---------|-----------|--------|
| `bookmark-created` | `chrome.bookmarks.onCreated` | Optional folder ID/name |
| `tab-navigated` | `chrome.tabs.onUpdated` | URL glob pattern |
| `tab-created` | `chrome.tabs.onCreated` | -- |
| `tab-closed` | `chrome.tabs.onRemoved` | -- |
| `download-completed` | `chrome.downloads.onChanged` | Filename glob pattern |
| `history-visited` | `chrome.history.onVisited` | URL glob pattern |
| `idle-changed` | `chrome.idle.onStateChanged` | State: active/idle/locked |
| `browser-startup` | `chrome.runtime.onStartup` | -- |
| `omnibox` | `chrome.omnibox.onInputEntered` | Keyword |
| `reading-list-changed` | `chrome.readingList` | -- |
| `window-created` | `chrome.windows.onCreated` | -- |
| `window-focused` | `chrome.windows.onFocusChanged` | -- |
| `window-closed` | `chrome.windows.onRemoved` | -- |
| `context-menu` | `chrome.contextMenus.onClicked` | Custom label |
| `clipboard-changed` | (periodic check) | -- |
| `filesystem-changed` | (OPFS watch) | Path pattern |

### Hook Execution Flow

```
Chrome event fires (e.g. bookmark created)
  |
  v
hooks/listener.ts:
  1. Load all hooks from chrome.storage
  2. Filter: enabled, correct trigger type, matching filter
  3. For each match:
       +-> Update trigger stats (lastTriggeredAt, triggerCount)
       +-> Build prompt: "[Hook triggered] Event context: ... Instructions: {hook.prompt}"
       +-> runAgenticLoop(hook.agentId, prompt)
```

## Skills System

Skills are installable instruction packages that extend an agent's system prompt with domain-specific knowledge.

### Skill Structure

```
agents/{id}/skills/{skill-id}/
  SKILL.md          Main instruction file (injected into system prompt)
  reference/        Supporting reference files (readable via tools)
    topic.md
    examples.md
```

### Installation Sources

- **Direct paste**: User provides SKILL.md content via `install_skill` tool
- **URL fetch**: `fetch_skill` tool fetches from GitHub repos or direct URLs
  - GitHub repos: uses GitHub API to find SKILL.md and reference/ directories
  - Direct URLs: fetches markdown file directly

### Skill Manifest

```typescript
interface SkillManifest {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
  source?: string;  // install URL
}
```

Skill content is injected into the system prompt at the start of each agent loop invocation, after CLAUDE.md and before the autonomous task instructions.

## Scheduled Tasks

Chrome alarms drive periodic agent work:

```
chrome.alarms.create("agent-123:daily-review", { periodInMinutes: 1440 })
  |
  v
chrome.alarms.onAlarm fires
  |
  v
background.ts:
  1. Look up ScheduledTask by alarmId
  2. runAgenticLoop(task.agentId, task.prompt)
  3. Record result in task.runHistory (last 10 runs)
  4. Update lastRunAt, lastResult
```

## AI Provider Support

| Provider | Models | Features |
|----------|--------|----------|
| Anthropic | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | Vision, default |
| Google | Gemini 2.5 Pro, Flash, Flash Lite | Vision, grounded search |
| OpenAI | GPT-4o, GPT-4o-mini, o3-mini | Vision |
| OpenRouter | Any model via OpenRouter API | Varies by model |

Provider search tools (e.g., Google grounded search) are injected alongside other tools when the active provider supports them.
