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

// Register all tools
for (const meta of [...chromeTools, ...fileTools, ...communicationTools, ...wasmTools]) {
  toolRegistry.register(meta);
}
