// Agent types
export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  visibility: 'private' | 'visible' | 'open';
  bookmarkFolderId?: string;
  createdAt: string;
  enabledTools?: string[];
  disabledTools?: string[];
  master?: boolean;
  temporary?: boolean;
  createdBy?: string;
  provider?: string;
  model?: string;
}

export interface AgentDetail extends AgentMeta {
  claudeMd: string;
  journal: string[];
  bookmarks: string[];
}

// Settings
export interface Settings {
  defaultAgentId?: string;
  activeProvider: string;
  theme: 'dark' | 'light' | 'system';
  model?: string;
}

export interface ApiKeys {
  [provider: string]: string | undefined;
}

// Hooks
export interface Hook {
  id: string;
  agentId: string;
  trigger: HookTrigger;
  prompt: string;
  description: string;
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

// Channels
export type ChannelDirection = 'inbound' | 'bidirectional';

export interface ChannelConfig {
  id: string;
  name?: string;
  type: string;
  direction: ChannelDirection;
  prompt?: string;
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface ChannelMessage {
  id: string;
  channelType: string;
  channelId: string;
  from: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelResponse {
  channelType: string;
  channelId: string;
  replyTo?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// Tasks
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

// Artifacts
export interface ArtifactMeta {
  agentId: string;
  path: string;
  description: string;
  timestamp: string;
}

// Conversations
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
  progress?: ProgressEntry[];
}

export interface ProgressEntry {
  type: 'step-start' | 'tool-call' | 'tool-result' | 'thinking' | 'text';
  stepNumber?: number;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  content?: string;
  timestamp: string;
}

// Usage
export interface UsageRecord {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  source: 'chat' | 'hook' | 'channel' | 'task' | 'message' | 'refine';
}

export interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byAgent: Record<string, { name: string; cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
}

export interface UsageQueryOptions {
  agentId?: string;
  provider?: string;
  since?: string;
  limit?: number;
}

// Skills
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  source?: string;
  installedAt: string;
  files: string[];
}

export interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  author?: string;
  source: string;
  url: string;
}

// Model config
export interface AgentModelConfig {
  provider: string;
  model: string;
  apiKey: string;
}

// Progress
export interface ProgressUpdate {
  type: 'thinking' | 'tool-call' | 'tool-result' | 'text' | 'step-complete' | 'done' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  iteration?: number;
  totalIterations?: number;
}

// Chat options
export interface ChatOptions {
  pageContext?: { title: string; url: string; content: string };
  columnId?: string;
}

export interface AgenticOptions extends ChatOptions {
  maxIterations?: number;
  source?: 'chat' | 'hook' | 'channel' | 'task' | 'message';
}

// File
export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
}

// Pagination
export interface PaginationOptions {
  limit?: number;
  cursor?: string;
  since?: string;
}
