# CHAOS - Product Requirements Document

## Vision

CHAOS (Chrome Agent OS) is a Chrome extension that gives a single user multiple personal AI agents living in their browser. Agents learn about the user over time, track intent, communicate with each other, and act on the user's behalf using Chrome's extension APIs and sandboxed tools.

The long-term vision: this could be the primary interface for Chrome. Not a bolt-on assistant, but the way you interact with the browser.

## Prior art

CHAOS builds on four existing projects:

- **[emaila.gent](https://github.com/PaulKinlan/emaila.gent)**: multi-agent learning system with self-editing personalities, activity journals, intent tracking, scheduled tasks, and per-agent isolated storage
- **[co-do](https://github.com/PaulKinlan/co-do)**: sandboxed WASM tool execution in Web Workers, file system access, multi-provider AI support, tool permission system
- **[NotebookLM-Chrome](https://github.com/PaulKinlan/NotebookLM-Chrome)**: content extraction from tabs (Readability.js + Turndown), safe rendering of AI output in sandboxed iframes, Chrome extension architecture patterns
- **[docker-agent-test](https://github.com/PaulKinlan/docker-agent-test)**: inter-agent communication via message passing, shared task boards with dependency DAGs, role-based agent identities, artifact sharing

## User

Single user. Their browser, their agents. No multi-user, no server-side infrastructure. API keys stored locally. Fully client-side.

## Agents

### Master agent

The first agent created is automatically marked as the **master agent**. The master agent uses a dedicated template with orchestration instructions and has access to sub-agent management tools:

- **create_agent** — create a new sub-agent with a name and role
- **assign_task** — delegate a task to a sub-agent
- **get_agent_status** — check a sub-agent's current status
- **find_agent** — search for agents by name or role
- **delete_agent** — remove a sub-agent

The master agent can coordinate work across sub-agents, breaking complex tasks into pieces and delegating them.

### Creating an agent

The user creates an agent by giving it a name and optionally picking a role template. Role templates bootstrap the agent's CLAUDE.md with starting traits, focus areas, and tool preferences. The agent evolves from there through self-editing. The master agent can also create sub-agents programmatically via tools.

### Role templates

- **neutral** - no specific focus, general-purpose assistant. The default.
- **master** - orchestration agent with sub-agent management tools. Automatically assigned to the first agent.
- **researcher** - web research, summarization, tracking topics
- **coder** - writing code, debugging, building things
- **writer** - drafting content, editing, tone
- **planner** - scheduling, coordination, reminders
- **reviewer** - critiquing work, catching issues
- Custom roles defined by the user

Roles shape the starting CLAUDE.md personality and which tools the agent prioritizes, but any agent can use any tool. The template is a starting point, not a constraint.

### Per-agent tool configuration

Each agent can have tools individually enabled or disabled via agent settings. This allows tailoring an agent's capabilities to its role — for example, disabling web tools for a coder agent or disabling file tools for a reviewer.

### Agent storage

Each agent gets an isolated directory in OPFS:

```
/agents/{agent-id}/
  CLAUDE.md              # Personality + instructions (self-editable by agent)
  memories/              # Structured knowledge (one file per topic)
  people/                # Person directory
  ideas/                 # Captured ideas
  activity-log.jsonl     # Cross-session activity journal
  suggestions-log.jsonl  # Suggestion tracking (acted on or ignored)
  TODO.md                # Active tasks
  bookmarks/             # Cached content from bookmarked pages
  conversations/         # Recent conversation history
```

### Agent lifecycle

1. User creates agent, picks name and role template
2. CLAUDE.md bootstrapped from template. The agent loop from emaila.gent is preserved: read instructions, do work, update own instructions based on what it learns.
3. Agent gets a dedicated bookmark folder in Chrome
4. On each interaction:
   - Read CLAUDE.md (may have been self-edited last session)
   - Read last 30 activity journal entries (pattern detection)
   - Read current context (active tab, recent bookmarks, pending messages from other agents)
   - Run agent loop with available tools
   - Write response, update journal, optionally update CLAUDE.md
5. On scheduled alarm: agent wakes up, reads context, does work, goes back to sleep

### Agent capabilities

- Read and summarize the current tab
- Search bookmarks and history
- Open tabs in the background to research things
- Create and manage tab groups
- Set alarms for future work
- Read and write files to their own OPFS volume
- Execute WASM tools (text processing, data conversion, etc.)
- Update their own personality and instructions
- Track patterns in user behavior and make suggestions
- Send and receive messages to/from other agents
- Publish and consume shared artifacts
- Coordinate on shared tasks with dependency tracking
- Install skills (SKILL.md instruction bundles) from paste, URL, or GitHub to gain specialised knowledge. Browse featured skills and preview before installing.
- Automatic task handoff: when a task completes, downstream tasks blocked by it are automatically triggered
- Agent archival: sub-agents can be archived (removed from active list, data preserved) and restored later

## Agent privacy and visibility

Agents are private by default. The user controls visibility per agent:

- **Private**: other agents don't know this agent exists. Memory, journal, and conversations are completely hidden.
- **Visible**: other agents can see this agent's name and role, and can send it messages. They cannot read its memory or journal.
- **Open**: other agents can see this agent and read its shared artifacts (files the agent explicitly publishes). Memory and journal remain private.

The user can change visibility at any time.

## Inter-agent communication

Agents never reach into each other's storage. They communicate through a message bus.

### Message format

Messages are free-form. The only required fields are routing metadata:

```json
{
  "id": "msg-uuid",
  "from": "agent-id",
  "to": "agent-id | broadcast",
  "timestamp": "2026-04-02T08:00:00Z",
  "body": "free-form content"
}
```

The body is intentionally unstructured. Agents can negotiate their own communication style. One agent might ask another to respond in JSON. Another might prefer plain text. An agent might ask a collaborator to always include a status field. This is up to them. The system provides the transport, not the format.

### Message storage and traceability

All messages are append-only and persisted:

```
/shared/
  messages.jsonl         # All inter-agent messages (append-only log)
  artifacts/             # Shared files agents publish for others
  tasks.jsonl            # Shared task board
```

Every message, task update, and artifact registration is logged with timestamps and agent IDs. The full history is always available for inspection. Nothing is deleted.

### Inspectability

The user can inspect all inter-agent activity:

- **Message log**: view all messages between agents, filtered by agent, time range, or keyword
- **Task board**: view all shared tasks, their status, dependencies, who claimed what, and when
- **Artifact registry**: view all shared files, who produced them, when, and who consumed them
- **Agent activity timeline**: combined view of an agent's messages sent/received, tasks worked on, artifacts produced/consumed

This is visible in the full tab dashboard UI. The user should always be able to understand what their agents are doing and why.

### Task coordination

Shared task board for multi-agent workflows:

- Tasks have: id, subject, description, owner, status (pending, in_progress, completed, failed), blocked_by, result, timestamps
- Tasks can declare dependencies (`blocked_by: ["task-id"]`)
- Agents only see tasks assigned to them or unassigned
- All status transitions are logged with timestamps
- Example workflow: "researcher gathers data, writer drafts post, reviewer checks it"

### Artifact sharing

- Agents publish files to `/shared/artifacts/` with metadata (description, producer, timestamp)
- Other visible agents can discover and read shared artifacts
- Private OPFS volumes are never exposed. Only explicitly published files are shared.
- Artifact reads are logged (who read what, when)

## Tool lookup service

Unlike MCP where tools are statically registered, CHAOS uses a tool lookup service. When an agent needs to do something, it describes what it wants and the lookup service resolves the right tool(s).

```
Agent: "I need to extract text from this PDF"
  ↓
Tool Lookup: matches intent → [pdf-to-text WASM tool]
  ↓
Agent executes tool with parameters
```

Benefits:
- Agents don't need all tools in their context window
- New tools added without updating agent prompts
- Tools ranked by relevance, capability, and user preference
- The lookup service can learn which tools work best for which intents

### Implementation

Default: **local embedding search**. Each tool has a description and example intents stored as embeddings. Agent's intent is embedded and matched via cosine similarity. Top-k tools returned.

The interface is abstract so we can swap in an **LLM-based resolver** if local embeddings aren't accurate enough:

```typescript
interface ToolLookup {
  resolve(intent: string, context?: ToolContext): Promise<Tool[]>;
}

class EmbeddingToolLookup implements ToolLookup { ... }
class LLMToolLookup implements ToolLookup { ... }
```

### Tool categories

1. **Chrome API tools** (31 tools)
   - Tabs: tab_read, tab_open, tab_close, tab_list, tab_group, tab_focus, tab_navigate, tab_screenshot, tab_duplicate, tab_pin, tab_mute, tab_move
   - Bookmarks: bookmark_add, bookmark_search, bookmark_list, bookmark_remove
   - Alarms: alarm_set, alarm_clear, alarm_list
   - Windows: window_create, window_list, window_focus, window_close, window_resize
   - Downloads: download_file, download_list
   - Reading list: reading_list_add, reading_list_query
   - Other: history_search, notification_show, clipboard_write

2. **File tools** (11 tools, OPFS operations)
   - read_file, write_file, edit_file, append_file, delete_file, rename_file
   - list_directory, mkdir, grep_file, find_files, file_info

3. **WASM tools** (7 tools, sandboxed in Web Workers)
   - wasm_base64, wasm_md5sum, wasm_sha256sum, wasm_wc, wasm_sort, wasm_uniq, wasm_json_format

4. **Web tools** (2 tools)
   - fetch_page (read a URL via content script or offscreen document)
   - web_search (web search)

5. **Communication tools** (10 tools)
   - message_send, message_read
   - task_create, task_update, task_list
   - artifact_publish, artifact_list, artifact_read
   - agent_discover

6. **Master tools** (5 tools, master agent only)
   - create_agent, delete_agent, assign_task, get_agent_status, find_agent

7. **Hook tools** (3 tools)
   - hook_create, hook_list, hook_delete

8. **Skill tools** (4 tools)
   - install_skill, remove_skill, list_skills, fetch_skill

9. **Provider search grounding** (provider-native, added automatically)
   - Google: google_search (Gemini native grounding)
   - OpenAI: web_search (web search preview tool)
   - Anthropic: web_search (web search tool)

Total: 73+ tools across all categories.

## Content extraction and rendering

### Tab content extraction (from NotebookLM-Chrome)
- **Readability.js** for article parsing (primary)
- **CSS selector fallback** (main, article, .post-content, etc.)
- **Turndown.js** to convert HTML to markdown

Two extraction paths:
- **tab_read**: content script injected into the active tab. Uses a three-tier fallback: (1) Readability.js parsing, (2) CSS selector extraction, (3) raw body text.
- **fetch_page**: offscreen document fetches arbitrary URLs and processes them with Readability + Turndown. Used when the page is not open in a tab.

### Safe rendering of agent output
- **DOMPurify** sanitization before rendering
- **Sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`) for interactive content
- **postMessage** typed communication between parent and sandbox
- Auto-resizing iframe based on content height

### Markdown
- **marked.js** with GFM enabled
- Post-process with DOMPurify

## UI

### App page (primary)
`app.html` opens in a regular browser tab (not a new tab page override). The extension opens via:
- **Icon click**: clicking the extension icon opens app.html in a new tab
- **Keyboard shortcut**: `Ctrl+Shift+C` (Mac: `Cmd+Shift+C`) opens app.html

The app uses **hash-based routing** (`#chat`, `#agents`, `#settings`, etc.) so state persists across page refreshes.

Tabs:
- **Chat tab** (default): **Multi-column TweetDeck-style layout**. Each conversation appears as a side-by-side column. Multiple columns can exist for the same agent. A `[+]` button adds new columns. Each column has its own agent selector, message history, streaming responses, and input. Columns can be individually closed.
- **Agents tab**: Overview of all agents — roles, visibility, status, CLAUDE.md, activity journal, bookmarks. Per-agent tool configuration (enable/disable individual tools).
- **Tasks tab**: Shared task board with status, dependencies, and filtering.
- **Messages tab**: Inter-agent communication log, filterable by agent and searchable.
- **Artifacts tab**: Shared files browser with metadata and content preview.
- **Files tab**: OPFS file explorer for transparency — browse each agent's directory tree (CLAUDE.md, memories/, people/, ideas/, activity-log.jsonl, etc.), view files with markdown rendering and JSONL syntax formatting, download any file. Read-only — agents manage their own files.
- **Settings tab**: API keys for multiple providers (Anthropic, Google, OpenAI, OpenRouter), provider selector, default role for new agents, browser permission management (optional with in-UI request flow), tool permission controls, and light/dark mode toggle.

### Side panel (secondary)
Persistent chat interface for quick in-page interactions. Agent switcher, page context reading, voice input. Works independently of the app page for when you want to chat without leaving the current page.

### Popup
Minimal. Agent switcher and quick status only.

### Context menu
Right-click context menu items are **hook-driven**. Hooks with `context-menu` trigger type register Chrome context menu items. When a context menu item is clicked, it opens a **new chat column** in the app with streaming progress (not silent background execution). The user sees the agent working in real-time.

### Hooks system
Event-driven agent execution. Hooks are created per-agent and fire when a matching Chrome event occurs. 14 trigger types:

- `bookmark-created` — with optional folder ID/name filter
- `tab-navigated` — with URL pattern filter
- `tab-created`
- `tab-closed`
- `download-completed` — with optional filename pattern filter
- `history-visited` — with URL pattern filter
- `idle-changed` — with state filter (active/idle/locked)
- `browser-startup`
- `omnibox` — with keyword filter
- `reading-list-changed`
- `window-created`
- `window-focused`
- `window-closed`
- `context-menu` — creates a Chrome context menu item with a custom label

Hooks include a **preset palette** for common use cases. Bookmark triggers support a **folder picker** for targeting specific bookmark folders.

When a hook fires, it runs the agentic loop with the hook's prompt plus event context. Context menu hooks open a new chat column; other hooks run in the background.

### Agentic loop
The agentic loop (`src/agents/agentic-loop.ts`) provides autonomous multi-step execution using `streamText`. It streams thinking text in real-time and keeps iterating until the agent responds with text and no tool calls, or hits a configurable max iteration limit (default 20).

**Progress display**: Each step shows a collapsible `<details>` element with step headers, tool call names, and expandable tool results. Progress is persisted to conversation history so it survives page refreshes.

**Used by**: scheduled tasks (alarms), hooks, context menu actions, and chat.

### Refine prompt
An LLM-powered prompt refinement feature. The user can click "Refine" on their input to have the AI improve it. A before/after dialog shows the original and refined versions, letting the user accept or reject the refinement.

### Voice input
Speech-to-text input via an **iframe-based recognition frame** (not direct Web Speech API on the page). Available in chat columns. Global hotkey `Ctrl+Shift+U` (Mac: `Cmd+Shift+U`) activates voice input for the current agent.

### @ Mention autocomplete
The chat input supports `@` mentions to inline browser context. Type `@` to see categories, then type a category and filter text to search. Categories:
- **@tab** — lists open tabs (requires `tabs` permission)
- **@bookmark** — searches bookmarks (requires `bookmarks` permission)
- **@history** — searches recent history (requires `history` permission)
- **@agent** — lists other agents (always available)

Selecting an item inserts a formatted mention (`@type[title](id)`) that is resolved to full content when the message is sent. For `@tab` mentions, the tab's page content is extracted. Mentions render as styled inline badges with category-colored backgrounds.

### Light/dark mode
System auto-detect via `prefers-color-scheme` with manual override in Settings. The theme preference persists across sessions.

### Browser permissions
Chrome permissions (scripting, tabs, bookmarks, history) are **optional**. Each permission can be enabled individually through an in-UI request flow in Settings. Agents gracefully degrade when permissions aren't granted.

## Storage

### OPFS (Origin Private File System)
- Per-agent persistent storage (isolated directories)
- Memory files, journal, TODO, bookmarks cache
- Shared space for inter-agent messages, tasks, artifacts
- No user permission needed (extension origin owns it)
- Survives extension updates

### IndexedDB
- Conversation history (per agent)
- Tool configurations and custom WASM tools
- Cached page content from tabs/bookmarks
- Embedding vectors for tool lookup

### Chrome storage
- Extension settings (agent list, default agent, UI preferences)
- Sync storage for cross-device agent list (metadata only, not content)
- Agent metadata (name, role, icon, bookmark folder ID, alarm schedules, visibility)

### Data migration rules
- All storage reads are defensive — missing fields get defaults at read time, not write time
- New fields are always optional (`?` in TypeScript types)
- Chrome storage uses sync/local fallback (try sync first, fall back to local)
- Old data without new fields must still load and render correctly
- IndexedDB version bumps handle all previous versions in upgrade functions
- No destructive overwrites on extension update

## Tech stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3 |
| UI | Vanilla HTML/CSS/JS (multi-column TweetDeck layout) |
| Agent loop | TypeScript, Vercel AI SDK (streamText, multi-provider) |
| Providers | Anthropic Claude, Google Gemini, OpenAI, OpenRouter |
| WASM runtime | Web Workers + WASI (from co-do) |
| Storage | OPFS + IndexedDB + Chrome storage API |
| Content extraction | Readability.js + Turndown.js (content script + offscreen document) |
| Rendering | marked.js + DOMPurify + sandboxed iframes |
| Routing | Hash-based (#chat, #agents, #settings, etc.) |
| Build | Vite |
| Language | TypeScript |

## Not in scope (yet)

- Multi-user
- Server-side infrastructure
- Publishing or sharing agent configurations
- Mobile (Chrome extension = desktop only)
- Inter-agent communication across devices
