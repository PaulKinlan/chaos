// ── Agent metadata (stored in chrome.storage) ──

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  visibility: 'private' | 'visible' | 'open';
  bookmarkFolderId?: string;
  createdAt: string; // ISO 8601
  enabledTools?: string[]; // If set, only these tools are available. If undefined, all tools.
  disabledTools?: string[]; // If set, these tools are excluded. Checked after enabledTools.
  master?: boolean;     // true for the master agent
  temporary?: boolean;  // true for master-created temporary agents
  createdBy?: string;   // agentId of the master that created this sub-agent
}

// ── Settings (stored in chrome.storage.sync) ──

export interface Settings {
  defaultAgentId?: string;
  activeProvider: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama';
  theme: 'dark' | 'light' | 'system';
  model?: string;
}

// ── API keys (stored in chrome.storage.local, never sync) ──

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  openrouter?: string;
  ollama?: string;  // base URL for Ollama (not actually an API key)
  brave?: string;
}

// ── Inter-agent messages ──

export interface AgentMessage {
  id: string;
  from: string;       // agent ID
  to: string;         // agent ID or 'broadcast'
  timestamp: string;  // ISO 8601
  body: string;       // free-form content
}

// ── Task event sourcing ──

export type TaskEventType = 'created' | 'updated' | 'status_changed' | 'deleted';

export interface TaskEvent {
  taskId: string;
  type: TaskEventType;
  timestamp: string;  // ISO 8601
  data: Partial<TaskData>;
}

export interface TaskData {
  subject: string;
  description?: string;
  owner?: string;         // agent ID
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  blockedBy?: string[];   // task IDs
  result?: string;
}

export interface Task {
  id: string;
  subject: string;
  description?: string;
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  blockedBy?: string[];
  result?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Artifact metadata ──

export interface ArtifactMeta {
  agentId: string;
  path: string;
  description: string;
  timestamp: string;  // ISO 8601
}

// ── IndexedDB store types ──

export interface Conversation {
  id: string;
  agentId: string;
  timestamp: string;
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  progress?: AgenticProgressEntry[];
}

export interface AgenticProgressEntry {
  type: 'step-start' | 'tool-call' | 'tool-result' | 'thinking' | 'text';
  stepNumber?: number;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  content?: string;
  timestamp: string;
}

export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  wasmUrl?: string;
  permissions: 'always' | 'ask' | 'never';
  config: Record<string, unknown>;
}

export interface PageCache {
  url: string;
  title: string;
  content: string;       // extracted markdown
  extractedAt: string;   // ISO 8601
  agentId?: string;
}

export interface Embedding {
  id: string;
  sourceType: 'tool' | 'memory' | 'page';
  sourceId: string;
  text: string;
  vector: number[];
}

// ── Scheduled tasks (alarm-driven agent work) ──

export interface ScheduledTaskRun {
  timestamp: string;      // ISO timestamp
  result: string;         // Full result text
  durationMs?: number;    // How long the run took
}

export interface ScheduledTask {
  alarmId: string;        // Chrome alarm name (namespaced: agentId:taskName)
  agentId: string;
  prompt: string;         // The natural language prompt to execute
  description: string;    // Human-readable description for the UI
  createdAt: string;      // ISO timestamp
  lastRunAt?: string;     // ISO timestamp of last execution
  lastResult?: string;    // Summary of last execution result
  runHistory?: ScheduledTaskRun[]; // Recent run results (last 10)
  schedule: {
    type: 'once' | 'recurring';
    delayInMinutes?: number;    // For one-shot
    periodInMinutes?: number;   // For recurring
  };
}

// ── Hooks (event-driven agent execution) ──

export interface Hook {
  id: string;
  agentId: string;
  trigger: HookTrigger;
  prompt: string;           // What the agent should do when triggered
  description: string;      // Human-readable description
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
}

export type HookTrigger =
  | { type: 'bookmark-created'; folderId?: string; folderName?: string }
  | { type: 'tab-navigated'; urlPattern: string }
  | { type: 'tab-created' }
  | { type: 'tab-closed' }
  | { type: 'download-completed'; filenamePattern?: string }
  | { type: 'history-visited'; urlPattern: string }
  | { type: 'idle-changed'; state: 'active' | 'idle' | 'locked' }
  | { type: 'browser-startup' }
  | { type: 'omnibox'; keyword: string }
  | { type: 'reading-list-changed' }
  | { type: 'window-created' }
  | { type: 'window-focused' }
  | { type: 'window-closed' }
  | { type: 'context-menu'; label: string }
  | { type: 'clipboard-changed' }
  | { type: 'filesystem-changed'; path?: string };
