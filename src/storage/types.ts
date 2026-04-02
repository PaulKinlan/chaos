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
}

// ── Settings (stored in chrome.storage.sync) ──

export interface Settings {
  defaultAgentId?: string;
  activeProvider: 'anthropic' | 'openai' | 'google' | 'openrouter';
  theme: 'dark' | 'light' | 'system';
}

// ── API keys (stored in chrome.storage.local, never sync) ──

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  openrouter?: string;
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

export type TaskEventType = 'created' | 'updated';

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

export interface ScheduledTask {
  alarmId: string;        // Chrome alarm name (namespaced: agentId:taskName)
  agentId: string;
  prompt: string;         // The natural language prompt to execute
  description: string;    // Human-readable description for the UI
  createdAt: string;      // ISO timestamp
  lastRunAt?: string;     // ISO timestamp of last execution
  lastResult?: string;    // Summary of last execution result
  schedule: {
    type: 'once' | 'recurring';
    delayInMinutes?: number;    // For one-shot
    periodInMinutes?: number;   // For recurring
  };
}
