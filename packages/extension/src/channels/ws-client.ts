// WebSocket client for the CHAOS relay server
// Delegates to the offscreen document for a persistent connection
// that survives service worker suspension

import type { RelaySettings } from './config.js';
import type { ChannelMessage } from './types.js';

type WsMessageHandler = (message: ChannelMessage) => void;

let messageHandler: WsMessageHandler | null = null;
let logHandler: ((msg: string) => void) | null = null;
let connected = false;
let currentSettings: RelaySettings | null = null;

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

/**
 * Ensure the offscreen document exists (shared with HTML parser).
 */
async function ensureOffscreen(): Promise<boolean> {
  try {
    if (!chrome.offscreen) return false;

    const contexts = await (chrome.runtime as unknown as {
      getContexts(filter: { contextTypes: string[] }): Promise<{ documentUrl: string }[]>;
    }).getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

    if (contexts && contexts.length > 0) return true;

    await chrome.offscreen.createDocument({
      url: 'src/offscreen-parser.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Parse HTML and maintain persistent WebSocket connection',
    });
    return true;
  } catch (err) {
    log(`Failed to create offscreen document: ${err}`);
    return false;
  }
}

/**
 * Listen for messages from the offscreen document (WS events + logs).
 */
chrome.runtime.onMessage.addListener((message, _sender) => {
  if (message.type === 'wsChannelMessage' && message.message && messageHandler) {
    log(`Received channel message ${message.message.id?.slice(0, 8) ?? '???'} from ${message.message.channelType ?? 'unknown'} via offscreen WS`);
    messageHandler(message.message as ChannelMessage);
  }
  if (message.type === 'wsLog' && typeof message.message === 'string') {
    log(message.message);
  }
});

/**
 * Open a WebSocket connection via the offscreen document.
 */
export async function connectWebSocket(settings: RelaySettings): Promise<void> {
  currentSettings = settings;
  const url = buildWsUrl(settings);

  const available = await ensureOffscreen();
  if (!available) {
    log('Offscreen document not available — WebSocket disabled');
    return;
  }

  try {
    await chrome.runtime.sendMessage({ type: 'wsConnect', wsUrl: url });
    connected = true;
    log('WebSocket connection delegated to offscreen document');
  } catch (err) {
    log(`Failed to start WS via offscreen: ${err}`);
    connected = false;
  }
}

/**
 * Disconnect the WebSocket.
 */
export function disconnectWebSocket(): void {
  currentSettings = null;
  connected = false;
  chrome.runtime.sendMessage({ type: 'wsDisconnect' }).catch(() => {});
  log('Disconnected');
}

/**
 * Check if the WebSocket is currently connected.
 */
export function isWebSocketConnected(): boolean {
  return connected;
}

/**
 * Check actual connection status from the offscreen document.
 */
export async function checkWebSocketStatus(): Promise<boolean> {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'wsStatus' });
    connected = result?.connected ?? false;
    return connected;
  } catch {
    connected = false;
    return false;
  }
}

/**
 * Set the handler that processes incoming channel messages from the WebSocket.
 */
export function setWsMessageHandler(handler: WsMessageHandler): void {
  messageHandler = handler;
}

/**
 * Set a log broadcast function.
 */
export function setWsLogHandler(handler: (msg: string) => void): void {
  logHandler = handler;
}
