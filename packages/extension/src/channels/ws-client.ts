// WebSocket client for the CHAOS relay server
// Provides instant message delivery as a complement to alarm-based polling

import type { RelaySettings } from './config.js';
import type { ChannelMessage } from './types.js';

type WsMessageHandler = (message: ChannelMessage) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let currentBackoff = 5000; // Start at 5 seconds
const MAX_BACKOFF = 60000; // Cap at 60 seconds
const PING_INTERVAL = 25000; // Send ping every 25s to keep connection alive
let messageHandler: WsMessageHandler | null = null;
let logHandler: ((msg: string) => void) | null = null;
let currentSettings: RelaySettings | null = null;

/**
 * Convert an HTTP(S) URL to a WS(S) URL and append the /ws path with token.
 * e.g. https://example.com -> wss://example.com/ws?token=abc123
 *      http://localhost:8787 -> ws://localhost:8787/ws?token=abc123
 */
function buildWsUrl(settings: RelaySettings): string {
  const base = settings.serverUrl.replace(/\/$/, '');
  const wsBase = base
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
  return `${wsBase}/ws?token=${encodeURIComponent(settings.apiKey)}`;
}

function log(msg: string): void {
  console.log(`[WS] ${msg}`);
  if (logHandler) logHandler(msg);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startPingTimer(): void {
  stopPingTimer();
  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // Send failed — close event will trigger reconnect
      }
    }
  }, PING_INTERVAL);
}

function stopPingTimer(): void {
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  if (!currentSettings) return;

  log(`Reconnecting in ${currentBackoff / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentSettings) {
      connectWebSocket(currentSettings);
    }
  }, currentBackoff);

  // Exponential backoff
  currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF);
}

/**
 * Open a WebSocket connection to the relay server.
 * On message: parses JSON and calls the message handler.
 * On close: auto-reconnects with exponential backoff.
 */
export function connectWebSocket(settings: RelaySettings): void {
  // Store settings for reconnection
  currentSettings = settings;

  // Clean up any existing connection
  if (socket) {
    try {
      socket.close();
    } catch {
      // Ignore close errors on stale socket
    }
    socket = null;
  }

  const url = buildWsUrl(settings);
  log(`Connecting to ${url.replace(/token=[^&]+/, 'token=***')}`);

  try {
    socket = new WebSocket(url);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`Failed to create WebSocket: ${errMsg}`);
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => {
    log('WebSocket connected to relay server');
    // Reset backoff on successful connection
    currentBackoff = 5000;
    // Start sending pings to keep the connection alive
    startPingTimer();
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String(event.data));
      const msg = data.payload || data.message;
      if (data.type === 'message' && msg && messageHandler) {
        log(`Received channel message ${msg.id?.slice(0, 8) ?? '???'} from ${msg.channelType ?? 'unknown'}`);
        messageHandler(msg as ChannelMessage);
      } else if (data.type === 'pong' || data.type === 'ping') {
        // Server keepalive — no action needed
      } else if (data.type === 'reply_ack') {
        log(`Reply acknowledged: ${data.responseId?.slice(0, 8) ?? '???'}`);
      } else {
        log(`Unknown WS message type: ${data.type}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Failed to parse WS message: ${errMsg}`);
    }
  });

  socket.addEventListener('close', (event) => {
    log(`Connection closed (code=${event.code}, reason=${event.reason || 'none'})`);
    socket = null;
    stopPingTimer();
    // Don't reconnect with stale credentials — let the poll alarm handle re-registration
    if (event.code === 1008 || event.reason?.includes('401') || event.reason?.includes('auth')) {
      log('Auth failure — waiting for poll alarm to re-register');
      return;
    }
    // Only reconnect if we haven't been explicitly disconnected
    if (currentSettings) {
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    log('Connection error — will reconnect on close');
    // The close event will fire after error, which triggers reconnect
  });
}

/**
 * Disconnect the WebSocket and stop reconnection attempts.
 */
export function disconnectWebSocket(): void {
  currentSettings = null;
  clearReconnectTimer();
  stopPingTimer();
  if (socket) {
    try {
      socket.close();
    } catch {
      // Ignore
    }
    socket = null;
  }
  log('Disconnected');
}

/**
 * Check if the WebSocket is currently connected.
 */
export function isWebSocketConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

/**
 * Set the handler that processes incoming channel messages from the WebSocket.
 */
export function setWsMessageHandler(handler: WsMessageHandler): void {
  messageHandler = handler;
}

/**
 * Set a log broadcast function (e.g. broadcastChannelLog from poller).
 */
export function setWsLogHandler(handler: (msg: string) => void): void {
  logHandler = handler;
}
