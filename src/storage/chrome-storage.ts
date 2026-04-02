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
  const result = await chrome.storage.sync.get(KEYS.AGENT_LIST);
  return (result[KEYS.AGENT_LIST] as AgentMeta[] | undefined) ?? [];
}

export async function setAgentList(agents: AgentMeta[]): Promise<void> {
  await chrome.storage.sync.set({ [KEYS.AGENT_LIST]: agents });
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

export async function updateScheduledTaskRun(alarmId: string, result: string): Promise<void> {
  const tasks = await getScheduledTasks();
  const task = tasks.find((t) => t.alarmId === alarmId);
  if (task) {
    task.lastRunAt = new Date().toISOString();
    task.lastResult = result.slice(0, 500);
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
