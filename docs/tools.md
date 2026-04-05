# CHAOS Tool Inventory

Every agent has access to a set of tools, filtered by the agent's `enabledTools`/`disabledTools` configuration and the global permission system (always/ask/never per tool).

## File Tools (Built-in)

Every agent gets these tools for managing its private OPFS storage. Paths are relative to the agent's root directory (`agents/{agentId}/`).

| Tool | Description | Parameters |
|------|-------------|------------|
| `read_file` | Read a file from your private storage. | `path: string` |
| `write_file` | Write content to a file. Creates the file and parent directories if they do not exist. | `path: string`, `content: string` |
| `edit_file` | Edit a file by replacing an exact string match. | `path: string`, `old_string: string`, `new_string: string` |
| `append_file` | Append content to a file. Creates the file if it does not exist. | `path: string`, `content: string` |
| `delete_file` | Delete a file. Cannot delete CLAUDE.md (protected). | `path: string` |
| `rename_file` | Rename or move a file within private storage. | `oldPath: string`, `newPath: string` |
| `list_directory` | List files and directories. | `path: string` (default: `.`) |
| `mkdir` | Create a directory. | `path: string` |
| `grep_file` | Search file contents for a text pattern. Returns matching lines with line numbers. Max 50 matches. | `pattern: string`, `path: string` (default: `.`) |
| `find_files` | Find files by name pattern (glob: `*.md`, `TODO*`). | `pattern: string`, `path: string` (default: `.`) |
| `file_info` | Get metadata about a file or directory (exists, type, size/entry count). | `path: string` |

**Note:** `read_file` and `list_directory` are minimum tools that cannot be disabled by agent config.

---

## Chrome Tools

Browser API tools wrapping Chrome extension APIs.

### Tabs

| Tool | Description | Parameters |
|------|-------------|------------|
| `tab_list` | List open browser tabs. Optionally filter by query string matching titles and URLs. | `query?: string` |
| `tab_open` | Open a URL in a new browser tab. By default opens in background. | `url: string`, `active?: boolean` (default: false) |
| `tab_close` | Close a browser tab by its ID. | `tabId: number` |
| `tab_focus` | Focus an existing tab and bring its window to the front. | `tabId: number` |
| `tab_navigate` | Navigate an existing tab to a new URL (reuses the tab). | `tabId: number`, `url: string` |
| `tab_read` | Read the content of a tab by extracting its page content as markdown. Defaults to the active tab. | `tabId?: number` |
| `tab_screenshot` | Capture a screenshot of the currently active tab. Returns a base64-encoded PNG data URL. | _(none)_ |
| `tab_duplicate` | Duplicate an existing browser tab. | `tabId: number` |
| `tab_pin` | Pin or unpin a browser tab. | `tabId: number`, `pinned: boolean` |
| `tab_mute` | Mute or unmute a browser tab. | `tabId: number`, `muted: boolean` |
| `tab_move` | Move a tab to a different position or window. | `tabId: number`, `windowId?: number`, `index?: number` (default: -1) |
| `tab_group` | Create a tab group or add tabs to an existing group with a title and color. | `tabIds: number[]`, `title: string`, `color?: string` |

### Windows

| Tool | Description | Parameters |
|------|-------------|------------|
| `window_list` | List all open browser windows with IDs, types, and bounds. | _(none)_ |
| `window_create` | Create a new browser window. Optionally open a URL, set size, or create incognito/popup. | `url?: string`, `type?: string`, `width?: number`, `height?: number`, `focused?: boolean`, `incognito?: boolean` |
| `window_close` | Close a browser window by its ID. | `windowId: number` |
| `window_focus` | Focus a browser window, bringing it to the front. | `windowId: number` |
| `window_resize` | Resize, move, or change the state of a window (minimize, maximize, fullscreen). | `windowId: number`, `width?: number`, `height?: number`, `left?: number`, `top?: number`, `state?: string` |

### Bookmarks

| Tool | Description | Parameters |
|------|-------------|------------|
| `bookmark_add` | Add a bookmark to the agent's dedicated bookmark folder. | `url: string`, `title: string` |
| `bookmark_list` | List all bookmarks in the agent's dedicated bookmark folder. | _(none)_ |
| `bookmark_search` | Search all bookmarks by query string. | `query: string` |
| `bookmark_remove` | Remove a bookmark by its ID. | `bookmarkId: string` |

### History

| Tool | Description | Parameters |
|------|-------------|------------|
| `history_search` | Search browsing history by query. Returns title, URL, last visit time, and visit count. | `query: string`, `maxResults?: number` (default: 20), `startTime?: number` (epoch ms) |

### Alarms (Scheduled Tasks)

| Tool | Description | Parameters |
|------|-------------|------------|
| `alarm_set` | Set a Chrome alarm for scheduling future work. Include a prompt describing what to do when it fires. | `name: string`, `delayInMinutes?: number`, `periodInMinutes?: number`, `prompt?: string`, `description?: string` |
| `alarm_clear` | Clear a previously set alarm by name. Also removes the associated scheduled task. | `name: string` |
| `alarm_list` | List all Chrome alarms set by this agent, including stored prompts and last run info. | _(none)_ |

### Notifications

| Tool | Description | Parameters |
|------|-------------|------------|
| `notification_show` | Show a desktop notification with a title and message. | `title: string`, `message: string` |

### Clipboard

| Tool | Description | Parameters |
|------|-------------|------------|
| `clipboard_write` | Write text to the system clipboard. Note: may be limited in service worker context. | `text: string` |

### Downloads

| Tool | Description | Parameters |
|------|-------------|------------|
| `download_file` | Download a file from a URL. Optionally specify a filename. | `url: string`, `filename?: string` |
| `download_list` | Search recent downloads. Optionally filter by query and limit results. | `query?: string`, `limit?: number` (default: 20) |

### Reading List

| Tool | Description | Parameters |
|------|-------------|------------|
| `reading_list_add` | Add a URL to the browser reading list with a title. | `url: string`, `title: string` |
| `reading_list_query` | Query the reading list. Optionally filter by URL or read/unread status. | `url?: string`, `hasBeenRead?: boolean` |

---

## Web Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `fetch_page` | Fetch a URL and extract content as markdown. Uses offscreen document with Readability + Turndown for proper DOM parsing. Falls back to regex-based extraction if unavailable. | `url: string` |
| `web_search` | Search the web using DuckDuckGo Instant Answer API (free) or Brave Search API (when key configured). Returns titles, URLs, and descriptions. | `query: string`, `maxResults?: number` |

---

## Communication Tools

Available to agents with `visibility` set to `visible` or `open`. Private agents do not get these tools.

### Messages

| Tool | Description | Parameters |
|------|-------------|------------|
| `message_send` | Send a message to another agent by ID, or broadcast to all visible agents. | `to: string` (agent ID or `"broadcast"`), `body: string` |
| `message_read` | Read messages sent to you (including broadcasts). Optionally filter by time and limit results. | `since?: string` (ISO 8601), `limit?: number` (default: 20) |

### Tasks

| Tool | Description | Parameters |
|------|-------------|------------|
| `task_create` | Create a new shared task on the task board. Tasks can have an owner and dependencies. | `subject: string`, `description?: string`, `owner?: string`, `blockedBy?: string[]` |
| `task_update` | Update the status of a shared task. Completing a task auto-triggers unblocked downstream tasks. | `taskId: string`, `status: string` (`in_progress` / `completed` / `failed`), `result?: string` |
| `task_list` | List tasks from the shared task board. Filter by agent, status, or unblocked only. | `agentId?: string`, `status?: string`, `unblockedOnly?: boolean` |

### Artifacts

| Tool | Description | Parameters |
|------|-------------|------------|
| `artifact_publish` | Publish a file from private storage as a shared artifact that other agents can discover and read. | `path: string`, `description: string` |
| `artifact_list` | List shared artifacts published by agents. Optionally filter by producing agent ID. | `agentId?: string` |
| `artifact_read` | Read the content of a shared artifact by its path. | `path: string` |

### Discovery

| Tool | Description | Parameters |
|------|-------------|------------|
| `agent_discover` | Discover other agents that are visible or open. Returns ID, name, role, and visibility. Private agents are excluded. | _(none)_ |

---

## Master Tools

The `find_agent` tool is available to all agents. The remaining tools are only available to agents with `master: true`.

| Tool | Description | Parameters |
|------|-------------|------------|
| `find_agent` | Search for agents by role or name (case-insensitive partial match). Available to all agents. | `role?: string`, `name?: string` |
| `create_agent` | Create a new sub-agent with a name, role, and purpose. Purpose is injected into the sub-agent's CLAUDE.md. Master only. | `name: string`, `role: string`, `purpose?: string`, `temporary?: boolean` |
| `delete_agent` | Delete or archive a sub-agent. Cannot delete self. Only deletes agents created by this master. If `preserveMemory` is true (default), archives instead of permanently deleting. Master only. | `agentId: string`, `preserveMemory?: boolean` (default: true) |
| `assign_task` | Create a task and assign it to a sub-agent, triggering its agentic loop immediately. Master only. | `agentId: string`, `description: string`, `prompt: string`, `blockedBy?: string[]` |
| `get_agent_status` | Check a sub-agent's metadata, recent activity (last 10 log entries), and pending tasks. Master only. | `agentId: string` |

---

## Hook Tools

Tools for managing event-driven triggers.

| Tool | Description | Parameters |
|------|-------------|------------|
| `hook_create` | Create a new hook with a trigger type, filter, and prompt. | `trigger: object` (see trigger types below), `prompt: string`, `description: string`, `enabled?: boolean` |
| `hook_list` | List all hooks for this agent with trigger, prompt, status, and stats. | _(none)_ |
| `hook_delete` | Delete a hook by ID. Only hooks belonging to this agent can be deleted. | `hookId: string` |

### Trigger Types for `hook_create`

| Type | Additional Fields |
|------|------------------|
| `bookmark-created` | `folderId?: string`, `folderName?: string` |
| `tab-navigated` | `urlPattern: string` (glob) |
| `tab-created` | _(none)_ |
| `tab-closed` | _(none)_ |
| `download-completed` | `filenamePattern?: string` (glob) |
| `history-visited` | `urlPattern: string` (glob) |
| `idle-changed` | `state: "active" \| "idle" \| "locked"` |
| `browser-startup` | _(none)_ |
| `omnibox` | `keyword: string` |
| `reading-list-changed` | _(none)_ |
| `window-created` | _(none)_ |
| `window-focused` | _(none)_ |
| `window-closed` | _(none)_ |
| `context-menu` | `label: string` |
| `clipboard-changed` | _(none)_ |
| `filesystem-changed` | `path?: string` |

---

## Skill Tools

Tools for managing installable skill packages.

| Tool | Description | Parameters |
|------|-------------|------------|
| `install_skill` | Install a skill from provided SKILL.md content. Optionally include reference files. | `name: string`, `description: string`, `content: string`, `referenceFiles?: Record<string, string>` |
| `fetch_skill` | Fetch and install a skill from a URL. Supports GitHub repos (auto-finds SKILL.md and reference/) and direct markdown URLs. | `url: string` |
| `list_skills` | List all skills installed on this agent with metadata. | _(none)_ |
| `remove_skill` | Remove an installed skill by its ID. | `skillId: string` |

---

## WASM Tools

Sandboxed tools that run as WebAssembly (with JS fallbacks for built-in tools). Each tool takes a single `input: string` parameter.

| Tool | Description | Keywords |
|------|-------------|----------|
| `base64` | Encode or decode base64. Input format: `encode:<text>` or `decode:<base64string>`. | base64, encode, decode, binary, text, convert |
| `md5sum` | Compute the MD5 hash of the input text. | md5, hash, checksum, digest, crypto |
| `sha256sum` | Compute the SHA-256 hash of the input text. | sha256, hash, checksum, digest, crypto |
| `wc` | Count lines, words, and characters in the input text. Returns `{lines} {words} {chars}`. | count, words, lines, characters, length, stats |
| `sort` | Sort lines of text alphabetically. | sort, order, alphabetical, arrange, lines |
| `uniq` | Remove consecutive duplicate lines from text. | unique, deduplicate, distinct, lines, duplicates |
| `json-format` | Pretty-print JSON with 2-space indentation. Input must be valid JSON. | json, format, pretty, print, indent, beautify |

Built-in WASM tools use JS fallback implementations for immediate availability. Additional WASM tools can be installed from WASM binaries stored in IndexedDB.

### WASM Tool Architecture

- Tools run in Web Workers for isolation
- Each tool has a manifest defining: name, description, keywords, input/output types, memory limit, timeout
- JS fallbacks run in the main thread when available (faster, no worker overhead)
- WASM binaries can be loaded for higher performance

---

## Provider Search Tools

Additional search tools injected based on the active AI provider:

| Provider | Tool | Description |
|----------|------|-------------|
| Google | `google_search` | Google grounded search via Gemini API |

These are only available when the corresponding provider is active and configured.
