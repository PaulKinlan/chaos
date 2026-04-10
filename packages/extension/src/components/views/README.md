# CHAOS View Components

Each view component owns a full screen of the application. Views are mounted by `app.ts` based on the `activeView` signal and receive data via properties. All views render into Light DOM.

## Common Patterns

- Every view has a `refresh()` method called by `app.ts` when the view becomes active
- Views fetch data via `sendMsg()` from `services/messaging.ts`
- Views fire custom events for cross-view navigation (e.g., jumping to chat with a prompt)
- Most views accept an `agents` property for resolving agent names
- Internal state uses `@state()` with underscore-prefixed names

---

## `<chaos-dashboard-view>`

Dashboard home view showing pinned artifacts, AI suggestions, recent artifacts, and activity stats.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | List of all agents (for name resolution) |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `view-change` | `{ view: string, prompt?: string }` | Navigate to another view, optionally with a chat prompt |
| `show-artifact-detail` | `{ artifact: ArtifactMeta }` | Request to show artifact detail modal |

**Data sources:** `getArtifacts`, `getUsageSummary`, `getHooks` (via `sendMsg`)

**Key behavior:**
- Auto-refreshes every 30 seconds
- Generates AI suggestions by prompting the master agent to analyze browsing activity
- Suggestions are stored as a JSON artifact and loaded on refresh
- Activity summary shows today's requests, tokens, cost, and hook fire counts

---

## `<chaos-chat-view>`

Multi-column chat container. A thin structural wrapper -- actual chat columns, streaming, and message management remain in `app.ts`.

**Properties:**

| Property | Type | Attribute | Description |
|----------|------|-----------|-------------|
| `multiColumn` | `boolean` | `multi-column` | Whether multi-column layout is active |

**Slots:**
- Default slot: chat column elements
- `add-picker` named slot: column add picker UI

---

## `<chaos-tasks-view>`

Jobs board showing collaborative tasks, scheduled tasks, and a task timeline.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | List of all agents |
| `activeAgentId` | `string \| null` | Currently selected agent |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `agent-jump` | `{ agentId: string, view: string }` | Navigate to a specific agent's task view |
| `run-scheduled-task` | `{ task: ScheduledTask }` | Run a scheduled task immediately |

**Data sources:** `getTaskState`, `getScheduledTasks`, `getTaskEvents`, `getMessages`

**Key behavior:**
- Agent and status filter dropdowns
- Jobs board table with click-to-expand detail modal
- Scheduled tasks section with Run Now / Cancel actions
- Task timeline showing chronological events across agents (created, updated, deleted, messages)

---

## `<chaos-artifacts-view>`

Artifact grid with filtering, search, detail modal, pin/download/delete actions.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | List of all agents |

**Data sources:** `getArtifacts`, `readArtifactContent`

**Key behavior:**
- Agent filter dropdown and text search
- Grid of artifact cards sorted by pinned status then timestamp
- Click to open detail modal with secure content viewer (double iframe sandbox)
- Pin/unpin, download, and delete actions
- Type badges (html, markdown, json, csv, image, text) with color coding

---

## `<chaos-channels-view>`

External channel management -- connects agents to webhooks, Discord, Telegram, Email, and file system channels via a relay server.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | List of all agents |

**Data sources:** Relay server API (`registerWithRelay`, `listChannels`, etc.), Chrome storage for local FS channels

**Key behavior:**
- Relay server connection setup with URL and agent registration
- Channel creation forms for each type (webhook, Discord, Telegram, Email, file system)
- Channel list with enable/disable/remove actions
- File system channels use FileSystemObserver API for local directory watching
- Connection status indicator and activity log

---

## `<chaos-hooks-view>`

Hook management -- create, edit, and manage browser event hooks that trigger agent actions.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | List of all agents |
| `activeAgentId` | `string \| null` | Currently selected agent |

**Data sources:** Port messages (`getHooks`, `addHook`, `updateHook`, `removeHook`)

**Key behavior:**
- Preset palette with quick-start hook templates (bookmark summarizer, morning briefing, etc.)
- Create/edit form with dynamic trigger-type-specific filter fields
- Trigger types: bookmark-created, tab-navigated, tab-created, tab-closed, download-completed, history-visited, idle-changed, browser-startup, omnibox, context-menu, reading-list-changed, window-created/focused/closed, clipboard-changed, filesystem-changed
- AI prompt refinement via global refine modal
- Hook list with enable/disable, edit, delete, trigger count display
- `setHooks()` method called from `app.ts` when port messages arrive

---

## `<chaos-usage-view>`

Usage and costs dashboard with time range filtering and spending alerts.

**Properties:** None (self-contained, fetches its own data)

**Data sources:** `getUsageSummary`, `getUsageRecords`, `getSpendingLimit`, `setSpendingLimit`

**Key behavior:**
- Time range selector: 24h, 7d, 30d, All time
- Stat cards: total cost, input/output tokens, request count
- Provider breakdown table and agent breakdown table
- Recent requests table with model, tokens, cost, timestamp
- Global spending alert configuration (dollar threshold)

---

## `<chaos-files-view>`

Agent memory file browser with tree navigation and content viewer.

**Properties:**

| Property | Type | Attribute | Description |
|----------|------|-----------|-------------|
| `activeAgentId` | `string \| null` | `active-agent-id` | Agent whose files to browse |

**Data sources:** `listAgentFiles`, `readAgentFile`

**Key behavior:**
- File tree on the left with expandable directories
- File content viewer on the right
- Markdown rendering (via marked + DOMPurify)
- JSONL formatting (pretty-prints each line)
- Raw text display with file size info

---

## `<chaos-messages-view>`

Inter-agent messages view with direction and search filtering.

**Properties:**

| Property | Type | Attribute | Description |
|----------|------|-----------|-------------|
| `activeAgentId` | `string \| null` | `active-agent-id` | Agent whose messages to show |
| `agents` | `AgentMeta[]` | `agents` | All agents for name resolution |

**Data sources:** `getMessages`

**Key behavior:**
- Direction filter: All, Sent, Received
- Text search across message bodies
- Messages filtered to show only those involving the active agent (or broadcasts)
- Chronological message list with sender/receiver labels

---

## `<chaos-agent-settings-view>`

Per-agent settings: name, model configuration, tools, skills, CLAUDE.md editor, usage, and danger zone.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `activeAgentId` | `string \| null` | Agent to configure |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `agent-deleted` | none | Agent was deleted (parent should handle cleanup) |

**Data sources:** `getAgentMeta`, `readAgentFile`, `getSettings`, `getUsageRecords`, `getSpendingLimit`

**Key behavior:**
- Agent name and role editing
- Model/provider selection with custom model input and per-agent API key override
- Tool enable/disable toggles (some tools like read_file/list_directory are always required)
- Skill browser: install from URL, preview before install, manual skill creation, uninstall
- CLAUDE.md system prompt editor with save
- Per-agent usage stats with time range selector
- Per-agent spending limit configuration
- Danger zone: archive/unarchive and delete agent

---

## `<chaos-global-settings-view>`

Global application settings: API keys, theme, permissions, and debug panel.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `agents` | `AgentMeta[]` | All agents (for archived agents list) |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `rerun-smart-start` | none | Re-run the onboarding smart start flow |

**Data sources:** `getApiKeys`, `getSettings`, Chrome permissions API, tool permissions

**Key behavior:**
- Provider API key configuration (Anthropic, Google, OpenAI, OpenRouter, Ollama)
- Active provider and model selection
- Theme toggle: System, Light, Dark
- Browser permission grants (scripting, tabs, bookmarks, history)
- Tool permission levels (always allow, ask, deny)
- Archived agents list with restore/delete
- Onboarding re-run button
- Debug panel (triple-click header to reveal): verbose logging toggle, state inspection, microphone test
