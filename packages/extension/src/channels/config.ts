// Channel relay configuration storage
// Uses chrome.storage.local to persist relay settings

export const DEFAULT_RELAY_URL = (typeof __CHAOS_DEFAULT_RELAY_URL__ !== 'undefined')
  ? __CHAOS_DEFAULT_RELAY_URL__
  : 'http://localhost:8787';

export interface RelaySettings {
  serverUrl: string;
  apiKey: string;
  userId: string;
  pollIntervalMinutes: number;
  lastPollTimestamp: string;
}

const RELAY_SETTINGS_KEY = 'chaos-relay-settings';

export async function getRelaySettings(): Promise<RelaySettings | null> {
  const result = await chrome.storage.local.get(RELAY_SETTINGS_KEY);
  return result[RELAY_SETTINGS_KEY] || null;
}

export async function setRelaySettings(settings: RelaySettings): Promise<void> {
  await chrome.storage.local.set({ [RELAY_SETTINGS_KEY]: settings });
}

export async function clearRelaySettings(): Promise<void> {
  await chrome.storage.local.remove(RELAY_SETTINGS_KEY);
}

export async function updateLastPollTimestamp(timestamp: string): Promise<void> {
  const settings = await getRelaySettings();
  if (settings) {
    settings.lastPollTimestamp = timestamp;
    await setRelaySettings(settings);
  }
}
