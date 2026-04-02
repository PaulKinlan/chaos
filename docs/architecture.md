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
┌─────────────────────────────────────────────────┐
│                  Chrome Extension                │
├─────────────┬───────────────────┬────────────────┤
│   UI Layer  │  Agent Runtime    │  Context Layer │
│             │                   │                │
│  - Popup    │  - Agent Manager  │  - Tab Reader  │
│  - Side     │  - Agent Loop     │  - Bookmark    │
│    Panel    │  - Memory Store   │    Watcher     │
│  - Options  │  - Journal        │  - Tab Groups  │
│             │  - Scheduler      │  - History     │
│             │                   │                │
├─────────────┴───────────────────┴────────────────┤
│                  Tool Layer                       │
│                                                   │
│  - Tool Lookup Service (resolves intent → tool)   │
│  - WASM Runtime (Web Workers, sandboxed)          │
│  - Built-in tools (file ops, text, data, crypto)  │
│  - Chrome API tools (tabs, bookmarks, alarms)     │
│                                                   │
├───────────────────────────────────────────────────┤
│                  Storage Layer                    │
│                                                   │
│  - OPFS (per-agent volumes: memory, journal, etc) │
│  - IndexedDB (conversations, tool configs)        │
│  - Chrome storage (extension settings, agent list) │
│                                                   │
└───────────────────────────────────────────────────┘
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

### Agent lifecycle

1. User creates agent (name, picks a role template)
2. Agent gets a CLAUDE.md bootstrapped from a **role template** (traits, focus, default tools). The template gives it a starting personality but the agent adapts from there via self-editing CLAUDE.md. The agent loop from emaila.gent is preserved: read instructions, do work, update own instructions based on what it learns.
3. Agent gets a dedicated bookmark folder in Chrome
4. On each interaction:
   - Read CLAUDE.md (may have been self-edited last time)
   - Read last 30 activity journal entries
   - Read current context (active tab, recent bookmarks, etc.)
   - Run agent loop with available tools
   - Write response, update journal, optionally update CLAUDE.md
5. On scheduled alarm: agent wakes up, reads context, does work, goes back to sleep

### Agent roles

Agents can have roles that define their focus and capabilities (inspired by [docker-agent-test](https://github.com/PaulKinlan/docker-agent-test)):

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

1. **Chrome API tools** (built-in, always available)
   - tab_read, tab_open, tab_close, tab_group
   - bookmark_add, bookmark_search, bookmark_list
   - alarm_set, alarm_clear, alarm_list
   - history_search
   - storage_get, storage_set

2. **File tools** (OPFS operations)
   - read, write, edit, list, delete, mkdir

3. **WASM tools** (sandboxed, from co-do)
   - Text processing (grep, sed, awk, sort, etc.)
   - Data formats (json, csv, toml, yaml, xml)
   - Crypto (hash, encode, decode)
   - Media (ffmpeg for audio/video if needed)

4. **Web tools**
   - fetch_page (read a URL)
   - search (web search)

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
- Sync storage for cross-device agent list (not content)
- Agent metadata (name, icon, bookmark folder ID, alarm schedules)

## Content extraction and rendering (from NotebookLM-Chrome)

### Tab content extraction
- **Readability.js** for article parsing (primary)
- **CSS selector fallback** (main, article, .post-content, etc.)
- **Turndown.js** to convert HTML to markdown (strips noise, flattens links)
- Content script injected at document_idle, responds to `extractContent` messages

### Safe rendering of agent output
- **DOMPurify** sanitization before rendering
- **Sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`) for interactive content
- **postMessage** typed communication between parent and sandbox
- Auto-resizing iframe based on content height

### Markdown
- **marked.js** with GFM enabled
- Post-process with DOMPurify

## UI

The primary interface is the **new tab page** (`app.html`), which overrides Chrome's default new tab with a full-width operating system view. The **side panel** remains available for quick in-page interactions without leaving the current page.

The vision: this could *be* the interface for Chrome in the future. Not a bolt-on assistant, but the primary way you interact with the browser.

- **New tab page** (`app.html`, `chrome_url_overrides.newtab`): The primary interface. Chat tab (default) provides a full-width conversation interface with agent selector, streaming responses, page context, and voice input (Web Speech API). Dashboard tabs (Agents, Tasks, Messages, Artifacts) provide the operating system view. Files tab provides an OPFS file explorer for browsing each agent's directory tree with markdown rendering and JSONL formatting. Settings tab includes provider selector, API key management, optional browser permission requests, and tool permissions.
- **Side panel**: persistent chat for quick in-page interactions, voice input, page context reading. Operates independently of the new tab page.
- **Popup**: minimal, just agent switcher and quick status
- **Context menu**: right-click to send selected text or page to an agent

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

Both the new tab chat and side panel support speech-to-text input via the Web Speech API:
- Click the microphone button to start/stop continuous recording
- Interim results displayed in real-time as the user speaks
- Final transcripts accumulated into the text input
- Gracefully hidden when the browser doesn't support the API

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
| UI | Vanilla HTML/CSS/JS or Lit (lightweight) |
| Agent loop | TypeScript, Vercel AI SDK (multi-provider) |
| WASM runtime | Web Workers + WASI (from co-do) |
| Storage | OPFS + IndexedDB + Chrome storage API |
| Build | Vite |
| Language | TypeScript |
