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

### Creating an agent

The user creates an agent by giving it a name and optionally picking a role template. Role templates bootstrap the agent's CLAUDE.md with starting traits, focus areas, and tool preferences. The agent evolves from there through self-editing.

### Role templates

- **neutral** - no specific focus, general-purpose assistant. The default.
- **researcher** - web research, summarization, tracking topics
- **coder** - writing code, debugging, building things
- **writer** - drafting content, editing, tone
- **planner** - scheduling, coordination, reminders
- **reviewer** - critiquing work, catching issues
- Custom roles defined by the user

Roles shape the starting CLAUDE.md personality and which tools the agent prioritizes, but any agent can use any tool. The template is a starting point, not a constraint.

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

1. **Chrome API tools** (built-in, always available)
   - tab_read, tab_open, tab_close, tab_group
   - bookmark_add, bookmark_search, bookmark_list
   - alarm_set, alarm_clear, alarm_list
   - history_search
   - storage_get, storage_set

2. **File tools** (OPFS operations)
   - read, write, edit, list, delete, mkdir

3. **WASM tools** (sandboxed in Web Workers, from co-do)
   - Text processing (grep, sed, awk, sort, etc.)
   - Data formats (json, csv, toml, yaml, xml)
   - Crypto (hash, encode, decode)
   - Media (ffmpeg for audio/video if needed)

4. **Web tools**
   - fetch_page (read a URL)
   - search (web search)

5. **Communication tools**
   - message_send, message_read
   - task_create, task_update, task_list
   - artifact_publish, artifact_list, artifact_read

## Content extraction and rendering

### Tab content extraction (from NotebookLM-Chrome)
- **Readability.js** for article parsing (primary)
- **CSS selector fallback** (main, article, .post-content, etc.)
- **Turndown.js** to convert HTML to markdown
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

### Side panel (primary)
Persistent conversation with the active agent. Shows context from current tab. Quick actions. Agent switcher. Always accessible without losing the current page.

### Full tab (dashboard / OS view)
`chrome-extension://id/app.html` - the operating system view:
- Agent overview (all agents, their roles, status, recent activity)
- Shared task board (all tasks, dependencies, status, who's working on what)
- Message log (inter-agent communication, filterable)
- Artifact browser (shared files, metadata, access log)
- Agent configuration (edit role, visibility, CLAUDE.md, alarm schedules)
- Activity timeline (combined view of agent actions)

### Popup
Minimal. Agent switcher and quick status only.

### Context menu
Right-click to send selected text or current page to an agent.

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

## Tech stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3 |
| UI | Vanilla HTML/CSS/JS or Lit |
| Agent loop | TypeScript, Vercel AI SDK (multi-provider) |
| WASM runtime | Web Workers + WASI (from co-do) |
| Storage | OPFS + IndexedDB + Chrome storage API |
| Content extraction | Readability.js + Turndown.js |
| Rendering | marked.js + DOMPurify + sandboxed iframes |
| Embeddings | Local model (TBD) for tool lookup |
| Build | Vite |
| Language | TypeScript |

## Not in scope (yet)

- Multi-user
- Server-side infrastructure
- Publishing or sharing agent configurations
- Mobile (Chrome extension = desktop only)
- Inter-agent communication across devices
