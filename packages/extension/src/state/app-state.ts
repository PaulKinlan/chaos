import { signal, computed } from '@preact/signals-core';
import type { AgentMeta, ArtifactMeta, Hook, AgentMessage, Task, TaskEvent, ScheduledTask, Settings, ApiKeys } from '../storage/types.js';

// Core application state as signals
export const activeView = signal<string>('chat');
export const activeAgentId = signal<string | null>(null);
export const agents = signal<AgentMeta[]>([]);
export const focusedColumnId = signal<string | null>(null);
export const debugMode = signal<boolean>(false);

// Data signals — updated by message handlers, watched by views
export const artifacts = signal<ArtifactMeta[]>([]);
export const hooks = signal<Hook[]>([]);

// Usage data signals
export interface UsageSummaryData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byAgent: Record<string, { name: string; cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byModel?: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
}

export interface UsageRecordData {
  timestamp: string;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  source: string;
}

export const usageSummary = signal<UsageSummaryData | null>(null);
export const usageRecords = signal<UsageRecordData[]>([]);
export const usageTimeRange = signal<string>('7d');

// Tasks/Jobs signals
export const tasks = signal<Task[]>([]);
export const scheduledTasks = signal<ScheduledTask[]>([]);
export const taskEvents = signal<TaskEvent[]>([]);

// Messages (inter-agent) signals
export const messages = signal<AgentMessage[]>([]);

// Settings signals
export const settings = signal<Settings | null>(null);
export const apiKeys = signal<ApiKeys | null>(null);

// Derived state
export const activeAgent = computed(() =>
  agents.value.find(a => a.id === activeAgentId.value) ?? null
);

export const masterAgent = computed(() =>
  agents.value.find(a => a.master) ?? null
);

export const visibleAgents = computed(() =>
  agents.value.filter(a => a.role !== 'archived')
);

// Today's usage — specifically for dashboard activity section
export const todayUsage = signal<UsageSummaryData | null>(null);

export async function refreshTodayUsage(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const result = await sendMsg<{ summary: UsageSummaryData }>({
      type: 'getUsageSummary',
      since: todayStart.toISOString(),
    });
    todayUsage.value = result.summary || null;
  } catch { /* */ }
}

export const pinnedArtifacts = computed(() =>
  artifacts.value.filter(a => a.pinned)
);

export const recentArtifacts = computed(() =>
  artifacts.value
    .filter(a => !a.pinned)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
);

// Helper to refresh artifacts from the background
export async function refreshArtifacts(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
    artifacts.value = result.artifacts || [];
  } catch { /* */ }
}

// Helper to refresh hooks from the background
export async function refreshHooks(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const result = await sendMsg<{ hooks: Hook[] }>({ type: 'getHooks' });
    hooks.value = result.hooks || [];
  } catch { /* */ }
}

// Helper to get usage "since" date from time range string
function getUsageSince(range: string): string | undefined {
  const now = Date.now();
  switch (range) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return undefined;
  }
}

// Helper to refresh usage data from the background
export async function refreshUsage(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const since = getUsageSince(usageTimeRange.value);
    const [summaryResult, recordsResult] = await Promise.all([
      sendMsg<{ summary: UsageSummaryData }>({ type: 'getUsageSummary', since }),
      sendMsg<{ records: UsageRecordData[] }>({ type: 'getUsageRecords', since, limit: 50 }),
    ]);
    usageSummary.value = summaryResult?.summary || null;
    usageRecords.value = recordsResult?.records || [];
  } catch {
    console.error('[app-state] Error refreshing usage data');
  }
}

// Helper to refresh tasks from the background
export async function refreshTasks(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const [collabResult, schedResult, eventsResult] = await Promise.all([
      sendMsg<{ tasks: Task[] }>({ type: 'getTaskState' }),
      sendMsg<{ tasks: ScheduledTask[] }>({ type: 'getScheduledTasks' }),
      sendMsg<{ events: TaskEvent[] }>({ type: 'getTaskEvents' }),
    ]);
    tasks.value = collabResult.tasks || [];
    scheduledTasks.value = schedResult.tasks || [];
    taskEvents.value = eventsResult.events || [];
  } catch {
    console.error('[app-state] Error refreshing tasks');
  }
}

// Helper to refresh messages from the background
export async function refreshMessages(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const result = await sendMsg<{ messages: AgentMessage[] }>({ type: 'getMessages' });
    messages.value = result.messages || [];
  } catch {
    console.error('[app-state] Error refreshing messages');
  }
}

// Helper to refresh settings from the background
export async function refreshSettings(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const [settingsResult, keysResult] = await Promise.all([
      sendMsg<{ settings: Settings }>({ type: 'getSettings' }),
      sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' }),
    ]);
    settings.value = settingsResult?.settings || null;
    apiKeys.value = keysResult?.keys || null;
  } catch {
    console.error('[app-state] Error refreshing settings');
  }
}
