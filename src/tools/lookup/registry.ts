/**
 * Tool Registry
 *
 * Central registry where all tools register their metadata.
 * Singleton instance used by lookup implementations.
 */

import type { ToolMeta } from './types.js';

class ToolRegistry {
  private tools: Map<string, ToolMeta> = new Map();

  register(meta: ToolMeta): void {
    this.tools.set(meta.name, meta);
  }

  getAll(): ToolMeta[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolMeta | undefined {
    return this.tools.get(name);
  }

  get size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}

/** Singleton tool registry */
export const toolRegistry = new ToolRegistry();

// ── Register all known tools ──

/** Chrome API tools */
const chromeTools: ToolMeta[] = [
  {
    name: 'tab_read',
    description: 'Read the content of a browser tab by extracting its page content as markdown.',
    keywords: ['tab', 'read', 'content', 'extract', 'page', 'markdown', 'scrape', 'text'],
    category: 'chrome',
  },
  {
    name: 'tab_open',
    description: 'Open a URL in a new browser tab.',
    keywords: ['tab', 'open', 'url', 'new', 'navigate', 'browse', 'visit', 'website'],
    category: 'chrome',
  },
  {
    name: 'tab_close',
    description: 'Close a browser tab by its ID.',
    keywords: ['tab', 'close', 'remove', 'delete', 'shut'],
    category: 'chrome',
  },
  {
    name: 'tab_list',
    description: 'List open browser tabs, optionally filtered by a query string.',
    keywords: ['tab', 'list', 'open', 'tabs', 'find', 'search', 'query', 'filter'],
    category: 'chrome',
  },
  {
    name: 'tab_group',
    description: 'Create a tab group or add tabs to an existing group with a title and color.',
    keywords: ['tab', 'group', 'organize', 'create', 'cluster', 'color', 'title'],
    category: 'chrome',
  },
  {
    name: 'bookmark_add',
    description: "Add a bookmark to this agent's dedicated bookmark folder.",
    keywords: ['bookmark', 'add', 'save', 'url', 'favorite', 'store', 'link'],
    category: 'chrome',
  },
  {
    name: 'bookmark_search',
    description: 'Search bookmarks by a query string.',
    keywords: ['bookmark', 'search', 'find', 'query', 'lookup', 'saved'],
    category: 'chrome',
  },
  {
    name: 'bookmark_list',
    description: "List all bookmarks in this agent's dedicated bookmark folder.",
    keywords: ['bookmark', 'list', 'all', 'show', 'saved', 'folder'],
    category: 'chrome',
  },
  {
    name: 'tab_focus',
    description: 'Focus an existing browser tab by its ID, making it the active tab.',
    keywords: ['tab', 'focus', 'activate', 'switch', 'select', 'bring', 'front'],
    category: 'chrome',
  },
  {
    name: 'tab_navigate',
    description: 'Navigate an existing tab to a new URL without opening a new tab.',
    keywords: ['tab', 'navigate', 'url', 'go', 'redirect', 'load', 'browse'],
    category: 'chrome',
  },
  {
    name: 'tab_screenshot',
    description: 'Capture a screenshot of the currently active tab.',
    keywords: ['tab', 'screenshot', 'capture', 'image', 'photo', 'snap', 'visible'],
    category: 'chrome',
  },
  {
    name: 'bookmark_remove',
    description: 'Remove a bookmark by its ID.',
    keywords: ['bookmark', 'remove', 'delete', 'unbookmark', 'unsave'],
    category: 'chrome',
  },
  {
    name: 'notification_show',
    description: 'Show a desktop notification with a title and message.',
    keywords: ['notification', 'notify', 'alert', 'show', 'desktop', 'message', 'popup'],
    category: 'chrome',
  },
  {
    name: 'clipboard_write',
    description: 'Write text to the system clipboard.',
    keywords: ['clipboard', 'copy', 'write', 'text', 'paste', 'clip'],
    category: 'chrome',
  },
  {
    name: 'history_search',
    description: 'Search the browsing history by query.',
    keywords: ['history', 'search', 'browse', 'visited', 'past', 'previous', 'find'],
    category: 'chrome',
  },
  {
    name: 'alarm_set',
    description: 'Set a Chrome alarm for scheduling future work.',
    keywords: ['alarm', 'set', 'schedule', 'timer', 'reminder', 'delay', 'future', 'cron'],
    category: 'chrome',
  },
  {
    name: 'alarm_clear',
    description: 'Clear a previously set Chrome alarm by name.',
    keywords: ['alarm', 'clear', 'cancel', 'remove', 'delete', 'stop'],
    category: 'chrome',
  },
  {
    name: 'alarm_list',
    description: 'List all Chrome alarms set by this agent.',
    keywords: ['alarm', 'list', 'show', 'all', 'scheduled', 'timers'],
    category: 'chrome',
  },
  {
    name: 'window_create',
    description: 'Create a new browser window, optionally with a URL, size, or incognito mode.',
    keywords: ['window', 'create', 'new', 'open', 'popup', 'incognito'],
    category: 'chrome',
  },
  {
    name: 'window_list',
    description: 'List all open browser windows.',
    keywords: ['window', 'list', 'all', 'open', 'windows'],
    category: 'chrome',
  },
  {
    name: 'window_focus',
    description: 'Focus a browser window by its ID.',
    keywords: ['window', 'focus', 'activate', 'front', 'switch'],
    category: 'chrome',
  },
  {
    name: 'window_close',
    description: 'Close a browser window by its ID.',
    keywords: ['window', 'close', 'remove', 'shut'],
    category: 'chrome',
  },
  {
    name: 'window_resize',
    description: 'Resize, move, or change the state of a browser window.',
    keywords: ['window', 'resize', 'move', 'minimize', 'maximize', 'fullscreen', 'position', 'size'],
    category: 'chrome',
  },
  {
    name: 'download_file',
    description: 'Download a file from a URL.',
    keywords: ['download', 'file', 'save', 'url', 'fetch'],
    category: 'chrome',
  },
  {
    name: 'download_list',
    description: 'Search recent downloads.',
    keywords: ['download', 'list', 'search', 'recent', 'files', 'history'],
    category: 'chrome',
  },
  {
    name: 'reading_list_add',
    description: 'Add a URL to the browser reading list.',
    keywords: ['reading', 'list', 'add', 'save', 'later', 'read'],
    category: 'chrome',
  },
  {
    name: 'reading_list_query',
    description: 'Query the browser reading list.',
    keywords: ['reading', 'list', 'query', 'search', 'saved', 'read'],
    category: 'chrome',
  },
  {
    name: 'tab_duplicate',
    description: 'Duplicate an existing browser tab.',
    keywords: ['tab', 'duplicate', 'copy', 'clone'],
    category: 'chrome',
  },
  {
    name: 'tab_pin',
    description: 'Pin or unpin a browser tab.',
    keywords: ['tab', 'pin', 'unpin', 'sticky', 'lock'],
    category: 'chrome',
  },
  {
    name: 'tab_mute',
    description: 'Mute or unmute a browser tab.',
    keywords: ['tab', 'mute', 'unmute', 'sound', 'audio', 'silence'],
    category: 'chrome',
  },
  {
    name: 'tab_move',
    description: 'Move a tab to a different window or position.',
    keywords: ['tab', 'move', 'reorder', 'position', 'window', 'transfer'],
    category: 'chrome',
  },
];

/** File tools (from agent loop) */
const fileTools: ToolMeta[] = [
  {
    name: 'read_file',
    description: 'Read a file from the agent private storage.',
    keywords: ['file', 'read', 'open', 'content', 'load', 'get', 'text'],
    category: 'file',
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the agent private storage.',
    keywords: ['file', 'write', 'save', 'create', 'store', 'output'],
    category: 'file',
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing an exact string match.',
    keywords: ['file', 'edit', 'replace', 'update', 'modify', 'change', 'patch'],
    category: 'file',
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a directory in the agent private storage.',
    keywords: ['directory', 'list', 'files', 'ls', 'folder', 'browse', 'contents'],
    category: 'file',
  },
  {
    name: 'mkdir',
    description: 'Create a directory and any missing parent directories in the agent private storage.',
    keywords: ['directory', 'create', 'mkdir', 'folder', 'new'],
    category: 'file',
  },
  {
    name: 'append_file',
    description: 'Append content to a file. Creates the file if it does not exist.',
    keywords: ['file', 'append', 'add', 'log', 'journal', 'write', 'concat'],
    category: 'file',
  },
  {
    name: 'grep_file',
    description: 'Search file contents for a text pattern. Returns matching lines with line numbers.',
    keywords: ['grep', 'search', 'find', 'pattern', 'match', 'content', 'text', 'file'],
    category: 'file',
  },
  {
    name: 'find_files',
    description: 'Find files by name pattern using simple glob matching.',
    keywords: ['find', 'files', 'search', 'glob', 'pattern', 'name', 'locate', 'discover'],
    category: 'file',
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the agent private storage.',
    keywords: ['file', 'delete', 'remove', 'clean', 'erase'],
    category: 'file',
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file within the agent private storage.',
    keywords: ['file', 'rename', 'move', 'relocate', 'reorganize'],
    category: 'file',
  },
  {
    name: 'file_info',
    description: 'Get metadata about a file or directory: exists, size, type.',
    keywords: ['file', 'info', 'metadata', 'size', 'exists', 'stat', 'type'],
    category: 'file',
  },
];

/** Communication tools */
const communicationTools: ToolMeta[] = [
  {
    name: 'message_send',
    description: 'Send a message to another agent or broadcast to all visible agents.',
    keywords: ['message', 'send', 'communicate', 'tell', 'notify', 'broadcast', 'agent'],
    category: 'communication',
  },
  {
    name: 'message_read',
    description: 'Read messages sent to this agent, including broadcasts.',
    keywords: ['message', 'read', 'inbox', 'receive', 'check', 'mail'],
    category: 'communication',
  },
  {
    name: 'task_create',
    description: 'Create a new shared task on the task board.',
    keywords: ['task', 'create', 'new', 'todo', 'assign', 'work', 'job'],
    category: 'communication',
  },
  {
    name: 'task_update',
    description: 'Update the status of a shared task.',
    keywords: ['task', 'update', 'status', 'progress', 'complete', 'fail', 'done'],
    category: 'communication',
  },
  {
    name: 'task_list',
    description: 'List tasks from the shared task board with optional filtering.',
    keywords: ['task', 'list', 'tasks', 'board', 'show', 'pending', 'status'],
    category: 'communication',
  },
  {
    name: 'artifact_publish',
    description: 'Publish a file from private storage as a shared artifact for other agents.',
    keywords: ['artifact', 'publish', 'share', 'file', 'output', 'export'],
    category: 'communication',
  },
  {
    name: 'artifact_list',
    description: 'List shared artifacts published by agents.',
    keywords: ['artifact', 'list', 'shared', 'files', 'published', 'available'],
    category: 'communication',
  },
  {
    name: 'artifact_read',
    description: 'Read the content of a shared artifact by its path.',
    keywords: ['artifact', 'read', 'content', 'shared', 'file', 'get'],
    category: 'communication',
  },
  {
    name: 'agent_discover',
    description: 'Discover other agents that are visible or open.',
    keywords: ['agent', 'discover', 'find', 'other', 'list', 'who', 'visible'],
    category: 'communication',
  },
];

/** WASM tools */
const wasmTools: ToolMeta[] = [
  {
    name: 'wasm_base64',
    description: 'Encode or decode base64. Input format: "encode:<text>" or "decode:<base64string>".',
    keywords: ['base64', 'encode', 'decode', 'binary', 'text', 'convert'],
    category: 'wasm',
  },
  {
    name: 'wasm_md5sum',
    description: 'Compute the MD5 hash of the input text.',
    keywords: ['md5', 'hash', 'checksum', 'digest', 'crypto'],
    category: 'wasm',
  },
  {
    name: 'wasm_sha256sum',
    description: 'Compute the SHA-256 hash of the input text.',
    keywords: ['sha256', 'hash', 'checksum', 'digest', 'crypto', 'sha'],
    category: 'wasm',
  },
  {
    name: 'wasm_wc',
    description: 'Count lines, words, and characters in the input text.',
    keywords: ['count', 'words', 'lines', 'characters', 'wc', 'length', 'stats'],
    category: 'wasm',
  },
  {
    name: 'wasm_sort',
    description: 'Sort lines of text alphabetically.',
    keywords: ['sort', 'order', 'alphabetical', 'arrange', 'lines'],
    category: 'wasm',
  },
  {
    name: 'wasm_uniq',
    description: 'Remove consecutive duplicate lines from text.',
    keywords: ['unique', 'deduplicate', 'uniq', 'distinct', 'lines', 'duplicates'],
    category: 'wasm',
  },
  {
    name: 'wasm_json_format',
    description: 'Pretty-print JSON with 2-space indentation.',
    keywords: ['json', 'format', 'pretty', 'print', 'indent', 'beautify'],
    category: 'wasm',
  },
];

/** Web tools */
const webTools: ToolMeta[] = [
  {
    name: 'fetch_page',
    description: 'Fetch a web page by URL and return its main content as markdown.',
    keywords: ['fetch', 'page', 'url', 'web', 'download', 'html', 'markdown', 'scrape', 'content'],
    category: 'web',
  },
  {
    name: 'web_search',
    description: 'Search the web. Delegates to tab-based browsing for results.',
    keywords: ['search', 'web', 'google', 'query', 'find', 'lookup', 'internet'],
    category: 'web',
  },
];

// Register all tools
for (const meta of [...chromeTools, ...fileTools, ...communicationTools, ...wasmTools, ...webTools]) {
  toolRegistry.register(meta);
}
