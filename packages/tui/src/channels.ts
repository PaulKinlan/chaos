/**
 * Channel system for the TUI — connects to the CHAOS relay server.
 *
 * Uses @chaos/sdk's ChannelsAPI with a Node.js RelayConnection implementation.
 * Same channel types as the Chrome extension: Telegram, Discord, Email, Webhook.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { ChaosSDK } from '@chaos/sdk';
import type { ChannelMessage, ChannelConfig } from '@chaos/sdk';
import type { RelayConnection } from '@chaos/sdk/connections';

export type { ChannelMessage, ChannelConfig };

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const RELAY_FILE = path.join(BASE_DIR, 'relay.json');
const CHANNELS_FILE = path.join(BASE_DIR, 'channels.json');

export interface RelaySettings {
  serverUrl: string;
  apiKey: string;
  userId: string;
  pollIntervalMinutes: number;
  lastPollTimestamp: string;
}

// ── Config persistence ──

function ensureDir(): void { fs.mkdirSync(BASE_DIR, { recursive: true }); }

export function loadRelaySettings(): RelaySettings | null {
  ensureDir();
  if (!fs.existsSync(RELAY_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(RELAY_FILE, 'utf-8')); } catch { return null; }
}

export function saveRelaySettings(settings: RelaySettings): void {
  ensureDir();
  fs.writeFileSync(RELAY_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export function loadChannelConfigs(): ChannelConfig[] {
  ensureDir();
  if (!fs.existsSync(CHANNELS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8')); } catch { return []; }
}

export function saveChannelConfigs(configs: ChannelConfig[]): void {
  ensureDir();
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(configs, null, 2), 'utf-8');
}

// ── Node.js RelayConnection implementation ──

export function createNodeRelayConnection(serverUrl: string, apiKey?: string): RelayConnection {
  const baseUrl = serverUrl.replace(/\/$/, '');
  let storedApiKey = apiKey || '';

  return {
    async register(): Promise<{ userId: string; apiKey: string }> {
      const resp = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(`Registration failed: ${resp.status}`);
      const data = await resp.json() as { userId: string; apiKey: string };
      storedApiKey = data.apiKey;
      return data;
    },

    async fetch(relayPath: string, options?: RequestInit): Promise<Response> {
      return globalThis.fetch(`${baseUrl}${relayPath}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${storedApiKey}`,
          ...(options?.headers || {}),
        },
      });
    },

    async connect(): Promise<{ close(): void; onMessage(handler: (msg: unknown) => void): void }> {
      const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?token=${storedApiKey}`;
      const socket = new WebSocket(wsUrl);
      let handler: ((msg: unknown) => void) | null = null;

      socket.on('message', (data) => {
        try { handler?.(JSON.parse(data.toString())); } catch { /* */ }
      });

      return {
        close() { socket.close(); },
        onMessage(h) { handler = h; },
      };
    },
  };
}

// ── SDK-backed ChannelsAPI ──

let sdkInstance: ChaosSDK | null = null;
let wsConnection: { close(): void } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Create a ChaosSDK instance with relay connection for the TUI.
 * The SDK's ChannelsAPI handles all channel operations via the relay.
 */
export function createChannelsSDK(settings: RelaySettings): ChaosSDK {
  const relay = createNodeRelayConnection(settings.serverUrl, settings.apiKey);

  // Minimal stores — TUI doesn't use most SDK features, just channels
  const noopStore = {
    async get() { return undefined; },
    async set() {},
    async remove() {},
    async getMultiple() { return {}; },
  };
  const noopMemory = {
    async read() { return ''; },
    async write() {},
    async append() {},
    async delete() {},
    async list() { return []; },
    async mkdir() {},
    async exists() { return false; },
    async search() { return []; },
  };

  const sdk = new ChaosSDK({
    relay,
    settings: noopStore,
    memory: noopMemory,
    conversations: {
      async get() { return undefined; },
      async list() { return []; },
      async save() {},
      async delete() {},
    },
    hooks: {
      async list() { return []; },
      async get() { return undefined; },
      async add() {},
      async update() {},
      async remove() {},
    },
    usage: {
      async record() {},
      async query() { return []; },
      async clear() {},
    },
    agentStore: {
      async list() { return []; },
      async get() { return undefined; },
      async add() {},
      async update() {},
      async remove() {},
    },
  });

  sdkInstance = sdk;
  return sdk;
}

export function getChannelsSDK(): ChaosSDK | null {
  return sdkInstance;
}

// ── High-level start/stop (uses SDK's ChannelsAPI) ──

export async function startChannels(settings: RelaySettings, handler: (msg: ChannelMessage) => void): Promise<void> {
  const sdk = createChannelsSDK(settings);

  // Connect WebSocket for real-time messages
  wsConnection = await sdk.channels.connectWebSocket(handler);

  // Polling fallback
  let lastPoll = settings.lastPollTimestamp;
  pollTimer = setInterval(async () => {
    if (wsConnection) return; // WS is primary
    try {
      const result = await sdk.channels.pollMessages(lastPoll);
      for (const msg of result.messages) handler(msg);
      if (result.since) {
        lastPoll = result.since;
        settings.lastPollTimestamp = lastPoll;
        saveRelaySettings(settings);
      }
    } catch { /* skip */ }
  }, (settings.pollIntervalMinutes || 1) * 60_000);

  console.log(`[channels] Started (relay: ${settings.serverUrl})`);
}

export function stopChannels(): void {
  wsConnection?.close();
  wsConnection = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  sdkInstance = null;
  console.log('[channels] Stopped');
}

export function isWebSocketConnected(): boolean {
  return wsConnection !== null;
}

// Re-export relay functions for direct use (backwards compat with ChannelsPanel)
export async function registerWithRelay(serverUrl: string): Promise<{ userId: string; apiKey: string }> {
  const relay = createNodeRelayConnection(serverUrl);
  return relay.register();
}
