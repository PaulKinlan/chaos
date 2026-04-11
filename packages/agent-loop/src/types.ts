import type { LanguageModel, ToolSet } from 'ai';

// Progress events emitted during agent execution
export interface ProgressEvent {
  type:
    | 'thinking'
    | 'tool-call'
    | 'tool-result'
    | 'text'
    | 'step-complete'
    | 'done'
    | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  step?: number;
  totalSteps?: number;
}

// Skill definition
export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string; // The actual skill instructions
  author?: string;
  version?: string;
}

// Skill store interface
export interface SkillStore {
  list(): Promise<Skill[]>;
  get(skillId: string): Promise<Skill | undefined>;
  install(skill: Skill): Promise<void>;
  remove(skillId: string): Promise<void>;
  search(
    query: string,
  ): Promise<
    Array<{ id: string; name: string; description: string; url?: string }>
  >;
}

// Usage record
export interface UsageRecord {
  timestamp: string;
  step: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  model: string;
}

// Usage summary for a run
export interface RunUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  steps: number;
  records: UsageRecord[];
}

// Permission levels
export type PermissionLevel = 'always' | 'ask' | 'never';
export type PermissionMode = 'accept-all' | 'deny-all' | 'ask';

export interface PermissionConfig {
  mode: PermissionMode;
  tools?: Record<string, PermissionLevel>; // per-tool overrides
  onPermissionRequest?: (request: {
    toolName: string;
    args: unknown;
  }) => Promise<boolean>;
}

// Hook events
export interface PreToolUseEvent {
  toolName: string;
  args: unknown;
  step: number;
}

export interface PostToolUseEvent {
  toolName: string;
  args: unknown;
  result: unknown;
  step: number;
  durationMs: number;
}

export interface StepStartEvent {
  step: number;
  totalSteps: number;
  tokensSoFar: number;
  costSoFar: number;
}

export interface StepCompleteEvent {
  step: number;
  hasToolCalls: boolean;
  text: string;
}

export interface CompleteEvent {
  result: string;
  totalSteps: number;
  usage: RunUsage;
  aborted: boolean;
}

// Hook decision
export interface HookDecision {
  decision: 'allow' | 'deny' | 'ask' | 'stop' | 'continue';
  reason?: string;
  modifiedArgs?: unknown; // for PreToolUse: modify the tool's input
}

// Hooks configuration
export interface AgentHooks {
  onPreToolUse?: (event: PreToolUseEvent) => Promise<HookDecision | void>;
  onPostToolUse?: (event: PostToolUseEvent) => Promise<void>;
  onStepStart?: (event: StepStartEvent) => Promise<HookDecision | void>;
  onStepComplete?: (event: StepCompleteEvent) => Promise<void>;
  onComplete?: (event: CompleteEvent) => Promise<void>;
  onUsage?: (record: UsageRecord) => Promise<void>;
}

// Pricing table
export type PricingTable = Record<string, { input: number; output: number }>;

// Agent configuration
export interface AgentConfig {
  id: string;
  name: string;
  model: LanguageModel;
  systemPrompt?: string; // Raw system prompt (CLAUDE.md content)
  tools?: ToolSet;
  skills?: SkillStore;
  maxIterations?: number;
  innerStepLimit?: number;
  hooks?: AgentHooks;
  permissions?: PermissionConfig;
  usage?: {
    enabled?: boolean;
    pricing?: PricingTable;
    limits?: {
      perRun?: number;
      perDay?: number;
    };
    onLimitExceeded?: (event: {
      type: string;
      spent: number;
      limit: number;
    }) => Promise<boolean>;
  };
  signal?: AbortSignal;
}

// A message in conversation history
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Agent instance
export interface Agent {
  readonly id: string;
  readonly name: string;
  run(task: string, context?: string, history?: ConversationMessage[]): Promise<string>;
  stream(task: string, context?: string, history?: ConversationMessage[]): AsyncIterable<ProgressEvent>;
  abort(): void;
}

// Run result
export interface RunResult {
  text: string;
  usage: RunUsage;
  steps: number;
  aborted: boolean;
}
