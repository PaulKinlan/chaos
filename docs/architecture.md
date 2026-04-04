# CHAOS - Chrome Agent OS

## What is this?

A Chrome extension that gives you multiple personal AI agents living in your browser. Each agent has its own personality, memory, and capabilities. They learn about you over time, track your intent, and can act on your behalf using Chrome's extension APIs.

The name: **C**hrome **A**gent **O**perating **S**ystem. The H is silent. Or maybe it stands for something. We'll figure it out.

## Core concepts

### From emaila.gent

The multi-agent architecture and learning system. Each agent gets:

- **Own identity** (name, personality, CLAUDE.md that the agent can self-edit)
- **Own memory** (memories/, people/, ideas/ as plain files in OPFS)
- **Activity journal** (activity-log.jsonl for cross-session pattern detection)
- **Intent tracking** (TODO management, stale detection, repeated themes)
- **Proactive suggestions** (pattern detection heuristics from journal data)
- **Scheduled tasks** (via Chrome alarms API instead of server-side cron)

Key difference from emaila.gent: no email interface. The trigger is the user in the extension popup, context menu, or scheduled alarms. No server-side sandbox either. Everything runs client-side.

### From co-do

The sandboxed tool execution runtime:

- **WASM tools in Web Workers** (isolated execution, true termination, memory limits)
- **File system access** (OPFS for persistent agent storage, File System Access API for user directories)
- **Tool permission system** (always/ask/never per tool)
- **Pipe command chaining** (tool output chains)
- **Multi-provider AI support** (Anthropic, OpenAI, Google, OpenRouter)

Key difference from co-do: tools are NOT MCP. There's a **tool lookup service** that resolves the right tool for a given intent, rather than the agent needing to know all available tools upfront.

### New: Chrome extension APIs as context and capabilities

This is what makes CHAOS different from both parent projects. The browser IS the operating system:

- **Tabs as context**: add the current tab's content to an agent's context. The agent can read page content, metadata, screenshots.
- **Bookmarks as context**: each agent gets a dedicated bookmark folder. Bookmark a page to an agent's folder and it becomes part of their knowledge.
- **Tab groups**: agents can organize tabs into groups, open background tabs to do research.
- **Chrome alarms**: scheduled work. An agent can set an alarm to check something later, do periodic reviews, or run recurring tasks.
- **Background service worker**: agents can do work in the background without the popup being open.
- **Side panel**: persistent UI that doesn't disappear when you click away (unlike popup).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Chrome Extension                      │
├──────────────┬────────────────────┬───────────────────────┤
│   UI Layer   │   Agent Runtime    │    Context Layer      │
│              │                    │                       │
│  - App page  │  - Agent Manager   │  - Tab Reader         │
│    (multi-   │  - Agentic Loop    │    (content script)   │
│    column    │    (streamText)    │  - Bookmark Watcher   │
│    chat)     │  - Master Agent    │  - Tab Groups         │
│  - Side      │  - Hooks Listener  │  - History            │
│    Panel     │  - Memory Store    │  - Offscreen Doc      │
│  - Popup     │  - Journal         │    (fetch_page)       │
│  - Hash      │  - Scheduler       │  - @ Mention          │
│    Router    │                    │    Resolution         │
│              │                    │                       │
├──────────────┴────────────────────┴───────────────────────┤
│                       Tool Layer (69+ tools)              │
│                                                           │
│  - Chrome API tools (31): tabs, bookmarks, windows, etc.  │
│  - File tools (11): OPFS read/write/edit/grep/find        │
│  - Communication tools (10): messages, tasks, artifacts   │
│  - WASM tools (7): base64, hashing, sort, json, etc.      │
│  - Master tools (5): create/delete/assign/find agents     │
│  - Hook tools (3): create/list/delete hooks               │
│  - Web tools (2): fetch_page, web_search                  │
│  - Provider search grounding (Google/OpenAI/Anthropic)    │
│  - Tool Lookup Service (resolves intent → tool)           │
│                                                           │
├───────────────────────────────────────────────────────────┤
│                      Storage Layer                        │
│                                                           │
│  - OPFS (per-agent volumes: memory, journal, etc)         │
│  - IndexedDB (conversations, tool configs)                │
│  - Chrome storage (settings, agent list, hooks)           │
│  - Defensive reads, sync/local fallback, migrations       │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Agents

### Agent structure

Each agent is a directory in OPFS:

```
/agents/{agent-id}/
  CLAUDE.md              # Agent personality + instructions (self-editable)
  memories/              # Structured knowledge (one file per topic)
  people/                # Person directory
  ideas/                 # Captured ideas
  activity-log.jsonl     # Cross-session activity journal
  suggestions-log.jsonl  # What was suggested, what was acted on
  TODO.md                # Active tasks
  bookmarks/             # Cached content from bookmarked pages
  conversations/         # Recent conversation history
```

### Master agent

The first agent created is automatically marked as the master agent. It uses a dedicated master template (`src/agents/templates/master.ts`) with orchestration instructions. The master agent gets access to 5 additional tools for sub-agent management: `create_agent`, `delete_agent`, `assign_task`, `get_agent_status`, `find_agent`. These tools are only available to agents marked as master in the tool registry.

### Agent lifecycle

1. User creates agent (name, picks a role template). The first agent gets the master template automatically.
2. Agent gets a CLAUDE.md bootstrapped from a **role template** (traits, focus, default tools). The template gives it a starting personality but the agent adapts from there via self-editing CLAUDE.md. The agent loop from emaila.gent is preserved: read instructions, do work, update own instructions based on what it learns.
3. Agent gets a dedicated bookmark folder in Chrome
4. On each interaction:
   - Read CLAUDE.md (may have been self-edited last time)
   - Read last 30 activity journal entries
   - Read current context (active tab, recent bookmarks, etc.)
   - Run agent loop with available tools via `agentic-loop.ts` (streamText-based autonomous loop)
   - Write response, update journal, optionally update CLAUDE.md
5. On scheduled alarm: agent wakes up, runs agentic loop, does work, goes back to sleep
6. On hook trigger: matching hook fires the agentic loop with hook prompt + event context

### Per-agent tool configuration

Tools can be individually enabled or disabled per agent through the agent settings UI. The tool registry respects these settings when building the tool set for each agent interaction. This allows agents to be purpose-scoped without changing their role template.

### Agent roles

Agents can have roles that define their focus and capabilities (inspired by [docker-agent-test](https://github.com/PaulKinlan/docker-agent-test)):

- **master** - orchestration agent with sub-agent management tools. Automatically assigned to the first agent.
- **researcher** - web research, summarization, tracking topics
- **coder** - writing code, debugging, building things
- **writer** - drafting content, editing, tone
- **planner** - scheduling, coordination, reminders
- **reviewer** - critiquing work, catching issues
- Custom roles defined by the user

Roles shape the agent's default CLAUDE.md personality and which tools it prioritizes, but any agent can use any tool.

### Agent privacy and visibility

Agents are private by default. The user controls visibility:

- **Private**: other agents don't know this agent exists. Its memory, journal, and conversations are completely hidden.
- **Visible**: other agents can see this agent's name and role, and can send it messages via the message bus. They cannot read its memory or journal directly.
- **Open**: other agents can see this agent and read its shared artifacts (files the agent explicitly publishes to a shared space). Memory and journal remain private.

The user can change visibility at any time per agent.

### Inter-agent communication

Agents don't reach into each other's storage. Instead, they communicate through a structured message bus (inspired by [docker-agent-test](https://github.com/PaulKinlan/docker-agent-test)'s email-based protocol):

```
/shared/
  messages/           # Message queue (JSONL, append-only)
  artifacts/          # Shared files agents publish for others
  tasks.jsonl         # Shared task board with dependency DAG
```

**Message protocol:**
- Agent sends a message: `{ from, to, subject, body, timestamp }`
- Messages can be directed (to a specific agent) or broadcast (to all visible agents)
- Receiving agent picks up messages on next wake (alarm or user interaction)
- Messages are structured, not free-form email. The schema is versioned.

**Task coordination:**
- Shared task board with status tracking (pending, in_progress, completed, failed)
- Tasks can declare `blocked_by` dependencies
- Agents only see tasks assigned to them or unassigned
- Useful for multi-agent workflows: "researcher gathers data, writer drafts post, reviewer checks it"

**Artifact sharing:**
- Agents publish files to `/shared/artifacts/` with metadata (description, producer, timestamp)
- Other visible agents can discover and read shared artifacts
- The agent's private OPFS volume remains private. Only explicitly shared files are visible.

### Agent capabilities

Agents can:
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
- Install and manage skills (SKILL.md bundles of instructions and reference material)

### Skills system

Agents can be extended with **skills** — bundles of markdown instructions and optional reference material stored in OPFS. Skills are injected into the agent's system prompt after CLAUDE.md, giving the agent specialised knowledge without modifying its core personality.

**Storage layout** in OPFS:
```
/agents/{agentId}/skills/
  skill-manifest.json           # Array of SkillMeta
  {skillId}/
    SKILL.md                    # Main instructions (injected into system prompt)
    reference/                  # Optional reference docs (read on demand via read_file)
      topic.md
```

**How skills are injected:**
- Both `loop.ts` and `agentic-loop.ts` call `buildSkillsPromptSection()` after reading CLAUDE.md
- Each installed skill's SKILL.md is appended under `## Installed Skills`
- Reference file paths are listed so the agent can read them on demand
- When no skills are installed, nothing is added

**Skill tools** (4 tools in `src/tools/skills/`):
- `install_skill` — install from pasted SKILL.md content with optional reference files
- `remove_skill` — remove a skill by ID
- `list_skills` — list installed skills
- `fetch_skill` — fetch and install from a URL (GitHub repo or direct SKILL.md)

**UI:** Agent Settings includes a Skills section for listing, installing (paste or URL), and removing skills.

## Tool lookup service

Unlike MCP where tools are statically registered, CHAOS uses a **tool lookup service**. When an agent needs to do something, it describes what it wants to do and the lookup service resolves the appropriate tool(s).

```
Agent: "I need to extract text from this PDF"
  ↓
Tool Lookup: matches intent → [pdf-to-text WASM tool]
  ↓
Agent executes tool with parameters
```

This means:
- Agents don't need to know all available tools upfront (context window savings)
- New tools can be added without updating agent prompts
- Tools can be ranked by relevance, capability, and user preference
- The lookup service itself can learn which tools work best for which intents

### Implementation: embedding search first, LLM fallback

The default implementation uses **local embedding search**:

1. Each tool has a description and example intents stored as embeddings
2. Agent's intent is embedded and compared via cosine similarity
3. Top-k tools returned to the agent

The interface is abstract so we can swap in an LLM-based resolver if local embeddings aren't accurate enough. The LLM approach would send the intent + a tool manifest to the model and let it pick. More accurate, but slower and costs tokens.

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
   - message_send, message_read, agent_discover
   - task_create, task_update, task_list
   - artifact_publish, artifact_list, artifact_read

6. **Master tools** (5 tools, master agent only)
   - create_agent, delete_agent, assign_task, get_agent_status, find_agent

7. **Hook tools** (3 tools)
   - hook_create, hook_list, hook_delete

8. **Skill tools** (4 tools)
   - install_skill, remove_skill, list_skills, fetch_skill

9. **Provider search grounding** (provider-native, added automatically per provider)
   - Google: google_search
   - OpenAI: web_search (preview)
   - Anthropic: web_search

## Storage

### OPFS (Origin Private File System)
- Per-agent persistent storage
- Memory files, journal, TODO, bookmarks cache
- No user permission needed (extension origin owns it)
- Survives extension updates

### IndexedDB
- Conversation history (per agent, per workspace)
- Tool configurations and custom WASM tools
- Cached page content from tabs/bookmarks

### Chrome storage
- Extension settings (which agents exist, default agent, UI prefs)
- Sync storage for cross-device agent list (not content), with local fallback
- Agent metadata (name, icon, bookmark folder ID, alarm schedules)
- Hook definitions and trigger counts
- Defensive reads: all storage reads handle missing fields with defaults at read time

## Content extraction and rendering (from NotebookLM-Chrome)

### Tab content extraction
Two extraction paths:

**tab_read** (content script, for open tabs):
- Three-tier fallback: (1) Readability.js parsing, (2) CSS selector extraction (main, article, .post-content, etc.), (3) raw body text
- Turndown.js converts HTML to markdown
- Content script injected at document_idle

**fetch_page** (offscreen document, for arbitrary URLs):
- Uses an offscreen document to fetch and process URLs not open in tabs
- Readability.js + Turndown.js processing in the offscreen context
- Avoids CORS issues by running in the extension's offscreen document

### Safe rendering of agent output
- **DOMPurify** sanitization before rendering
- **Sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`) for interactive content
- **postMessage** typed communication between parent and sandbox
- Auto-resizing iframe based on content height

### Markdown
- **marked.js** with GFM enabled
- Post-process with DOMPurify

## UI

The primary interface is `app.html`, which opens in a regular browser tab via icon click or `Ctrl+Shift+C` keyboard shortcut. It does **not** override the new tab page. The **side panel** remains available for quick in-page interactions without leaving the current page.

The app uses **hash-based routing** (`#chat`, `#agents`, `#settings`, etc.) so state persists across page refreshes.

The vision: this could *be* the interface for Chrome in the future. Not a bolt-on assistant, but the primary way you interact with the browser.

- **App page** (`app.html`, opens via icon click or `Ctrl+Shift+C`): The primary interface. Chat tab uses a **multi-column TweetDeck-style layout** with side-by-side conversation columns. Multiple columns can exist for the same agent. A `[+]` button adds new columns. Dashboard tabs (Agents, Tasks, Messages, Artifacts) provide the operating system view. Agents tab includes per-agent tool configuration. Files tab provides an OPFS file explorer. Settings tab includes provider selector, API key management, browser permissions, tool permissions, and light/dark mode toggle.
- **Side panel**: persistent chat for quick in-page interactions, voice input, page context reading. Operates independently of the app page.
- **Popup**: minimal, just agent switcher and quick status
- **Context menu**: hook-driven context menu items. Hooks with `context-menu` trigger type register Chrome context menu items. Clicking opens a new chat column with real-time progress.

### OPFS File Explorer

The Files tab provides read-only transparency into each agent's OPFS storage:

- Agent selector to switch between agents
- Tree view showing the directory structure (CLAUDE.md, memories/, people/, ideas/, etc.)
- Click a file to view its content in a viewer panel
- Markdown files rendered with marked.js, JSONL files shown with syntax highlighting
- File sizes displayed
- Download any file locally

The file explorer is read-only by design — agents manage their own files through the tool system. The explorer exists for user transparency and debugging.

### Voice Input

Speech-to-text input via an **iframe-based recognition frame**:
- A dedicated iframe handles Web Speech API recognition (avoids extension CSP issues)
- Global hotkey `Ctrl+Shift+U` (Mac: `Cmd+Shift+U`) activates voice input for the current agent
- Interim results displayed in real-time as the user speaks
- Final transcripts accumulated into the text input

### @ Mention Autocomplete

The chat input supports inline `@` mentions to pull browser context into conversations:
- **@tab** -- lists open tabs (requires `tabs` permission). Selecting inserts `@tab[Title](tabId)`.
- **@bookmark** -- searches bookmarks (requires `bookmarks` permission). Selecting inserts `@bookmark[Title](url)`.
- **@history** -- searches recent history (requires `history` permission). Selecting inserts `@history[Title](url)`.
- **@agent** -- lists other agents (always available). Selecting inserts `@agent[Name](agentId)`.

Typing `@` opens a category picker. Typing a category name and then a space filters results within that category. The dropdown supports keyboard navigation (arrows, Enter, Escape) and mouse selection. Max 8 results shown.

**Mention resolution in the agent loop**: Before the AI call, mentions are parsed from the user message. For `@tab` mentions, the tab's page content is extracted via `chrome.scripting`. For `@bookmark` and `@history`, the URL is included (with content extraction if the page is open in a tab). For `@agent`, the agent's name, role, and visibility are included. Resolved context is appended to the user message.

**Mention rendering**: In chat messages, `@type[title](id)` patterns are rendered as styled inline badges with category-colored backgrounds and SVG icons.

### Refine Prompt

LLM-powered prompt refinement. The user can click a "Refine" button on their input to have the AI improve it. A before/after dialog shows the original and refined versions, letting the user accept or reject the refinement before sending.

### Light/Dark Mode

System auto-detect via `prefers-color-scheme` media query with manual override in Settings. The theme preference is stored in Chrome storage and persists across sessions.

### Hash-based Routing

The app uses hash-based routing (`#chat`, `#agents`, `#settings`, etc.) to manage navigation state. This means the current view persists across page refreshes and can be bookmarked. The router listens for `hashchange` events and renders the appropriate tab.

### Hooks System

Event-driven agent execution via `src/hooks/listener.ts`. Hooks are stored in Chrome storage and registered as Chrome event listeners on extension startup. 14 trigger types:

- `bookmark-created` (optional folder filter), `tab-navigated` (URL pattern), `tab-created`, `tab-closed`
- `download-completed` (optional filename pattern), `history-visited` (URL pattern)
- `idle-changed` (state filter), `browser-startup`, `omnibox` (keyword)
- `reading-list-changed`, `window-created`, `window-focused`, `window-closed`
- `context-menu` (creates a Chrome context menu item with custom label)

Hooks include a **preset palette** for common use cases. Bookmark triggers support a **folder picker** UI. When a hook fires, it runs the agentic loop with the hook's prompt plus event context. Context menu hooks open a new chat column; other hooks run in the background.

Agents manage their own hooks via 3 hook tools: `hook_create`, `hook_list`, `hook_delete`.

### Agentic Loop

The **agentic loop** (`src/agents/agentic-loop.ts`) is the primary execution loop for all agent interactions. It uses `streamText` for real-time streaming and keeps iterating until the agent responds with text and no tool calls, or hits a configurable max iteration limit (default 20).

**Used by:** chat, scheduled tasks (alarms), hooks, and context menu actions.

Each iteration:
1. Calls `streamText` with the full conversation history and tools
2. Streams thinking text to the UI in real-time
3. If tools were called: appends response messages to history, adds a continuation prompt, and loops
4. If no tools were called: the agent is done, returns the final text

**Progress display**: Each step renders as a collapsible `<details>` element with step headers, tool call names, and expandable tool results. Progress is **persisted to conversation history** so it survives page refreshes and is visible when revisiting a conversation.

Progress updates are streamed to the UI via an `onProgress` callback and port messages (`agenticProgress`, `agenticDone`). The UI shows step indicators and tool call cards during execution, with a stop button to abort via `AbortSignal`.

### Browser Permissions

Chrome permissions are declared as `optional_permissions` in the manifest and requested at runtime:
- **scripting** + host permissions: needed for reading page content
- **tabs**: needed for tab management
- **bookmarks**: needed for bookmark integration
- **history**: needed for history search

Each permission has an Enable button in Settings. The UI shows current grant status and uses `chrome.permissions.request()` for the in-context request flow.

## What's NOT in scope (yet)

- Multi-user (this is single-user, your browser, your agents)
- Server-side anything (fully client-side, API keys stored locally)
- Publishing/sharing agents
- Mobile (Chrome extension = desktop only)

## Tech stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3 |
| UI | Vanilla HTML/CSS/JS (multi-column TweetDeck layout) |
| Agent loop | TypeScript, Vercel AI SDK (streamText, multi-provider) |
| Providers | Anthropic Claude, Google Gemini, OpenAI, OpenRouter |
| Search grounding | Provider-native search tools (Google, OpenAI, Anthropic) |
| WASM runtime | Web Workers + WASI (from co-do) |
| Storage | OPFS + IndexedDB + Chrome storage API |
| Content extraction | Readability.js + Turndown.js (content script + offscreen doc) |
| Routing | Hash-based (#chat, #agents, #settings, etc.) |
| Build | Vite |
| Language | TypeScript |
