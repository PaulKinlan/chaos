/**
 * Chrome storage wrapper.
 *
 * - Agent list and settings live in chrome.storage.sync (cross-device).
 * - API keys live in chrome.storage.local (never synced).
 */

import type { AgentMeta, Settings, ApiKeys } from './types.js';

// ── Keys ──

const KEYS = {
  AGENT_LIST: 'chaos:agents',
  SETTINGS: 'chaos:settings',
  API_KEYS: 'chaos:apiKeys',
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
