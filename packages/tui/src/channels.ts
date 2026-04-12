/**
 * Channel system for the TUI — connects to the CHAOS relay server
 * for external messaging (Telegram, Discord, Email, Webhook).
 *
 * Same relay protocol as the Chrome extension but using Node.js
 * native WebSocket and fetch (no offscreen document needed).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WebSocket } from 'ws';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const CHANNELS_FILE = path.join(BASE_DIR, 'channels.json');
const RELAY_FILE = path.join(BASE_DIR, 'relay.json');

// ── Types (matching extension) ──

export interface ChannelMessage {
  id: string;
  channelType: string;
  channelId: string;
  from: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelConfig {
  id: string;
  name?: string;
  type: string;
  direction: 'inbound' | 'bidirectional';
  prompt?: string;
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface RelaySettings {
  serverUrl: string;
  apiKey: string;
  userId: string;
  pollIntervalMinutes: number;
  lastPollTimestamp: string;
}

// ── Config persistence ──

function ensureDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

export function loadRelaySettings(): RelaySettings | null {
  ensureDir();
  if (!fs.existsSync(RELAY_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(RELAY_FILE, 'utf-8')); }
  catch { return null; }
}

export function saveRelaySettings(settings: RelaySettings): void {
  ensureDir();
  fs.writeFileSync(RELAY_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export function loadChannelConfigs(): ChannelConfig[] {
  ensureDir();
  if (!fs.existsSync(CHANNELS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8')); }
  catch { return []; }
}

export function saveChannelConfigs(configs: ChannelConfig[]): void {
  ensureDir();
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(configs, null, 2), 'utf-8');
}

// ── Relay API client ──

interface RelayConfig {
  serverUrl: string;
  apiKey: string;
}

async function relayFetch(config: RelayConfig, path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${config.serverUrl.replace(/\/$/, '')}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...(options.headers || {}),
    },
  });
}

export async function registerWithRelay(serverUrl: string): Promise<{ userId: string; apiKey: string }> {
  const resp = await fetch(`${serverUrl.replace(/\/$/, '')}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(`Registration failed: ${resp.status}`);
  const data = await resp.json() as { userId: string; apiKey: string };
  return data;
}

export async function pollMessages(config: RelayConfig, since: string): Promise<{ messages: ChannelMessage[]; since: string }> {
  const resp = await relayFetch(config, `/messages?since=${encodeURIComponent(since)}`);
  if (!resp.ok) throw new Error(`Poll failed: ${resp.status}`);
  return resp.json() as Promise<{ messages: ChannelMessage[]; since: string }>;
}

export async function sendReply(config: RelayConfig, reply: {
  channelType: string; channelId: string; replyTo?: string; content: string; metadata?: Record<string, unknown>;
}): Promise<void> {
  const resp = await relayFetch(config, '/reply', {
    method: 'POST',
    body: JSON.stringify(reply),
  });
  if (!resp.ok) throw new Error(`Reply failed: ${resp.status}`);
}

export async function listChannels(config: RelayConfig): Promise<ChannelConfig[]> {
  const resp = await relayFetch(config, '/channels');
  if (!resp.ok) throw new Error(`List channels failed: ${resp.status}`);
  const data = await resp.json() as { channels: ChannelConfig[] };
  return data.channels;
}

export async function registerChannel(config: RelayConfig, channel: Partial<ChannelConfig>): Promise<ChannelConfig> {
  const resp = await relayFetch(config, '/channels', {
    method: 'POST',
    body: JSON.stringify(channel),
  });
  if (!resp.ok) throw new Error(`Register channel failed: ${resp.status}`);
  const data = await resp.json() as { channel: ChannelConfig };
  return data.channel;
}

export async function registerTelegramChannel(config: RelayConfig, botToken: string, agentId?: string): Promise<{ channelId: string; botUsername: string }> {
  const resp = await relayFetch(config, '/channels/telegram/register', {
    method: 'POST',
    body: JSON.stringify({ botToken, agentId }),
  });
  if (!resp.ok) throw new Error(`Telegram registration failed: ${resp.status}`);
  return resp.json() as Promise<{ channelId: string; botUsername: string }>;
}

export async function registerDiscordChannel(config: RelayConfig, botToken: string, agentId?: string): Promise<{ channelId: string; botUsername: string }> {
  const resp = await relayFetch(config, '/channels/discord/register', {
    method: 'POST',
    body: JSON.stringify({ botToken, agentId }),
  });
  if (!resp.ok) throw new Error(`Discord registration failed: ${resp.status}`);
  return resp.json() as Promise<{ channelId: string; botUsername: string }>;
}

export async function removeChannel(config: RelayConfig, channelId: string): Promise<void> {
  const resp = await relayFetch(config, `/channels/${channelId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Remove channel failed: ${resp.status}`);
}

// ── WebSocket client ──

let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsBackoff = 5000;
let wsPingTimer: ReturnType<typeof setInterval> | null = null;
let messageHandler: ((msg: ChannelMessage) => void) | null = null;

export function setChannelMessageHandler(handler: (msg: ChannelMessage) => void): void {
  messageHandler = handler;
}

export function connectWebSocket(settings: RelaySettings): void {
  const wsUrl = settings.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '') + `/ws?token=${settings.apiKey}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[channels-ws] Connected');
      wsBackoff = 5000;
      wsPingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'message' && (parsed.payload || parsed.message)) {
          const msg = parsed.payload || parsed.message;
          messageHandler?.(msg as ChannelMessage);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('close', (code) => {
      console.log(`[channels-ws] Closed (${code})`);
      ws = null;
      if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
      if (code !== 1008) scheduleReconnect(settings);
    });

    ws.on('error', (err) => {
      console.warn('[channels-ws] Error:', err.message);
    });
  } catch (err) {
    console.warn('[channels-ws] Connect failed:', err);
    scheduleReconnect(settings);
  }
}

function scheduleReconnect(settings: RelaySettings): void {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket(settings);
  }, wsBackoff);
  wsBackoff = Math.min(wsBackoff * 2, 60_000);
}

export function disconnectWebSocket(): void {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
  if (ws) { try { ws.close(); } catch { /* */ } ws = null; }
}

export function isWebSocketConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

// ── Polling fallback ──

let pollTimer: ReturnType<typeof setInterval> | null = null;
const processedIds = new Set<string>();

export function startPolling(settings: RelaySettings): void {
  if (pollTimer) return;
  const interval = (settings.pollIntervalMinutes || 1) * 60_000;

  pollTimer = setInterval(async () => {
    if (isWebSocketConnected()) return; // WS is primary, skip poll

    try {
      const config = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };
      const result = await pollMessages(config, settings.lastPollTimestamp);

      for (const msg of result.messages) {
        if (processedIds.has(msg.id)) continue;
        processedIds.add(msg.id);
        messageHandler?.(msg);
      }

      if (result.since) {
        settings.lastPollTimestamp = result.since;
        saveRelaySettings(settings);
      }
    } catch (err) {
      console.warn('[channels-poll] Error:', err);
    }
  }, interval);

  // Initial poll
  setTimeout(() => pollTimer && pollTimer, 1000);
}

export function stopPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── High-level start/stop ──

export function startChannels(settings: RelaySettings, handler: (msg: ChannelMessage) => void): void {
  setChannelMessageHandler(handler);
  connectWebSocket(settings);
  startPolling(settings);
  console.log(`[channels] Started (relay: ${settings.serverUrl})`);
}

export function stopChannels(): void {
  disconnectWebSocket();
  stopPolling();
  console.log('[channels] Stopped');
}
