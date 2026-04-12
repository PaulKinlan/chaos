/**
 * Chrome storage wrapper.
 *
 * - Agent list and settings live in chrome.storage.sync (cross-device).
 * - API keys live in chrome.storage.local (never synced).
 */

import type { AgentMeta, Settings, ApiKeys, ScheduledTask, Hook } from './types.js';

// ── Keys ──

const KEYS = {
  AGENT_LIST: 'chaos:agents',
  SETTINGS: 'chaos:settings',
  API_KEYS: 'chaos:apiKeys',
  SCHEDULED_TASKS: 'chaos:scheduledTasks',
  HOOKS: 'chaos:hooks',
} as const;

// ── Defaults ──

const DEFAULT_SETTINGS: Settings = {
  activeProvider: 'anthropic',
  theme: 'system',
};

// ── Agent list (sync storage) ──

export async function getAgentList(): Promise<AgentMeta[]> {
  try {
    // Read from BOTH storages and take the one with more agents (most up-to-date)
    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get(KEYS.AGENT_LIST).catch(() => ({ [KEYS.AGENT_LIST]: [] })),
      chrome.storage.local.get(KEYS.AGENT_LIST).catch(() => ({ [KEYS.AGENT_LIST]: [] })),
    ]);

    const syncAgents = Array.isArray(syncResult[KEYS.AGENT_LIST]) ? syncResult[KEYS.AGENT_LIST] : [];
    const localAgents = Array.isArray(localResult[KEYS.AGENT_LIST]) ? localResult[KEYS.AGENT_LIST] : [];

    // Use local if it has agents and sync doesn't, or if local has more agents
    // (local is the fallback writer, so if it has data it's likely more current)
    let agents: unknown[];
    if (localAgents.length > 0 && localAgents.length >= syncAgents.length) {
      agents = localAgents;
    } else if (syncAgents.length > 0) {
      agents = syncAgents;
    } else {
      return [];
    }

    // Ensure each agent has required fields (defensive against schema changes)
    return agents.filter((a: unknown) =>
      a && typeof a === 'object' && 'id' in (a as Record<string, unknown>) && 'name' in (a as Record<string, unknown>)
    ) as AgentMeta[];
  } catch (err) {
    console.error('Failed to read agent list:', err);
    return [];
  }
}

export async function setAgentList(agents: AgentMeta[]): Promise<void> {
  // Always write to BOTH storages to prevent sync/local divergence
  const data = { [KEYS.AGENT_LIST]: agents };
  try {
    await chrome.storage.sync.set(data);
  } catch (err) {
    console.warn('Failed to write agent list to sync storage:', err);
  }
  // Always write to local as backup — this ensures getAgentList finds the latest data
  await chrome.storage.local.set(data);
}

// ── Settings (sync storage) ──

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get(KEYS.SETTINGS);
  const stored = result[KEYS.SETTINGS] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEYS.SETTINGS]: settings });
}

// ── API keys (local storage — never synced) ──

export async function getApiKeys(): Promise<ApiKeys> {
  const result = await chrome.storage.local.get(KEYS.API_KEYS);
  return (result[KEYS.API_KEYS] as ApiKeys | undefined) ?? {};
}

export async function setApiKeys(keys: ApiKeys): Promise<void> {
  await chrome.storage.local.set({ [KEYS.API_KEYS]: keys });
}

// ── Scheduled tasks (local storage) ──

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  const result = await chrome.storage.local.get(KEYS.SCHEDULED_TASKS);
  return (result[KEYS.SCHEDULED_TASKS] as ScheduledTask[] | undefined) ?? [];
}

export async function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.SCHEDULED_TASKS]: tasks });
}

export async function addScheduledTask(task: ScheduledTask): Promise<void> {
  const tasks = await getScheduledTasks();
  // Replace if same alarmId already exists
  const filtered = tasks.filter((t) => t.alarmId !== task.alarmId);
  filtered.push(task);
  await setScheduledTasks(filtered);
}

export async function removeScheduledTask(alarmId: string): Promise<void> {
  const tasks = await getScheduledTasks();
  await setScheduledTasks(tasks.filter((t) => t.alarmId !== alarmId));
}

export async function updateScheduledTaskRun(alarmId: string, result: string, durationMs?: number): Promise<void> {
  const tasks = await getScheduledTasks();
  const task = tasks.find((t) => t.alarmId === alarmId);
  if (task) {
    const now = new Date().toISOString();
    task.lastRunAt = now;
    task.lastResult = result.slice(0, 500);
    // Append to run history (keep last 10)
    if (!task.runHistory) task.runHistory = [];
    task.runHistory.push({ timestamp: now, result, durationMs });
    if (task.runHistory.length > 10) {
      task.runHistory = task.runHistory.slice(-10);
    }
    await setScheduledTasks(tasks);
  }
}

// ── Hooks (local storage) ──

export async function getHooks(): Promise<Hook[]> {
  const result = await chrome.storage.local.get(KEYS.HOOKS);
  return (result[KEYS.HOOKS] as Hook[] | undefined) ?? [];
}

export async function setHooks(hooks: Hook[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.HOOKS]: hooks });
}

export async function addHook(hook: Hook): Promise<void> {
  const hooks = await getHooks();
  // Replace if same id already exists
  const filtered = hooks.filter((h) => h.id !== hook.id);
  filtered.push(hook);
  await setHooks(filtered);
}

export async function updateHook(id: string, updates: Partial<Hook>): Promise<void> {
  const hooks = await getHooks();
  const hook = hooks.find((h) => h.id === id);
  if (hook) {
    Object.assign(hook, updates);
    await setHooks(hooks);
  }
}

export async function removeHook(id: string): Promise<void> {
  const hooks = await getHooks();
  await setHooks(hooks.filter((h) => h.id !== id));
}
