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

1. User creates agent (name, base personality, optional focus area)
2. Agent gets a CLAUDE.md built from template + user customizations
3. Agent gets a dedicated bookmark folder in Chrome
4. On each interaction:
   - Read CLAUDE.md (may have been self-edited last time)
   - Read last 30 activity journal entries
   - Read current context (active tab, recent bookmarks, etc.)
   - Run agent loop with available tools
   - Write response, update journal, optionally update CLAUDE.md
5. On scheduled alarm: agent wakes up, reads context, does work, goes back to sleep

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

## What's NOT in scope (yet)

- Multi-user (this is single-user, your browser, your agents)
- Server-side anything (fully client-side, API keys stored locally)
- Inter-agent communication (agents are isolated, like emaila.gent)
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
