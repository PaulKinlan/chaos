// Channel polling via Chrome alarms
// Periodically checks the relay server for new messages
// WebSocket provides the fast path; alarm polling is the reliable fallback

import { getRelaySettings, setRelaySettings, updateLastPollTimestamp } from './config.js';
import { pollMessages, sendReply, registerWithRelay, listChannels } from './relay-client.js';
import {
  connectWebSocket,
  disconnectWebSocket,
  isWebSocketConnected,
  setWsMessageHandler,
  setWsLogHandler,
} from './ws-client.js';
import type { ChannelMessage, ChannelResponse } from './types.js';

const ALARM_NAME = 'chaos-channel-poll';
const DEFAULT_INTERVAL_MINUTES = 1;
const FALLBACK_INTERVAL_MINUTES = 5; // Slower polling when WebSocket is connected

/** Broadcast a log message to any open extension pages (settings UI). */
export function broadcastChannelLog(message: string): void {
  chrome.runtime.sendMessage({ type: 'channelLog', message }).catch(() => {
    // No listeners — that's fine, the settings page may not be open.
  });
}

// Wire up WS log handler so WebSocket events appear in the channel logs UI
setWsLogHandler(broadcastChannelLog);

export function startChannelPolling(intervalMinutes?: number): void {
  const period = intervalMinutes || DEFAULT_INTERVAL_MINUTES;
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1, // Fire almost immediately on start
    periodInMinutes: period,
  });
  console.log(`Channel polling started (every ${period} min)`);
}

export function stopChannelPolling(): void {
  chrome.alarms.clear(ALARM_NAME);
  console.log('Channel polling stopped');
}

export function isChannelPollAlarm(alarmName: string): boolean {
  return alarmName === ALARM_NAME;
}

// Message handler type - the background script provides this
export type MessageHandler = (message: ChannelMessage) => Promise<string | null>;

let messageHandler: MessageHandler | null = null;

export function getMessageHandler(): MessageHandler | null {
  return messageHandler;
}

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;

  // Also wire up the WebSocket message handler to use the same logic
  setWsMessageHandler((message: ChannelMessage) => {
    // Fire-and-forget: process the message and send a reply if needed
    processMessage(message).catch((err) => {
      console.error('WS message processing failed:', err);
    });
  });
}

/**
 * Shared message processing logic used by both WebSocket and poll paths.
 * Calls the registered message handler and sends a reply if one is returned.
 */
// Track processed message IDs in chrome.storage.local to survive SW restarts
const PROCESSED_IDS_KEY = 'chaos-processed-message-ids';
let processedMessageIds: Set<string> | null = null;
const MAX_PROCESSED_IDS = 200;

async function loadProcessedIds(): Promise<Set<string>> {
  if (processedMessageIds) return processedMessageIds;
  try {
    const result = await chrome.storage.local.get(PROCESSED_IDS_KEY);
    const ids = result[PROCESSED_IDS_KEY] as string[] | undefined;
    processedMessageIds = new Set(ids || []);
  } catch {
    processedMessageIds = new Set();
  }
  return processedMessageIds;
}

async function saveProcessedIds(): Promise<void> {
  if (!processedMessageIds) return;
  const arr = Array.from(processedMessageIds);
  // Keep only the most recent IDs
  const trimmed = arr.length > MAX_PROCESSED_IDS ? arr.slice(arr.length - MAX_PROCESSED_IDS) : arr;
  await chrome.storage.local.set({ [PROCESSED_IDS_KEY]: trimmed }).catch(() => {});
}

async function markProcessed(id: string): Promise<boolean> {
  const ids = await loadProcessedIds();
  if (ids.has(id)) return false;
  ids.add(id);
  // Save periodically (not on every message to reduce writes)
  if (ids.size % 5 === 0) saveProcessedIds();
  return true;
}

// Cache of known channel IDs — refreshed periodically
let knownChannelIds: Set<string> | null = null;
let channelCacheTime = 0;
const CHANNEL_CACHE_TTL = 60_000; // 1 minute

async function getKnownChannels(config: { serverUrl: string; apiKey: string }): Promise<Set<string>> {
  if (knownChannelIds && Date.now() - channelCacheTime < CHANNEL_CACHE_TTL) {
    return knownChannelIds;
  }
  try {
    const channels = await listChannels(config);
    knownChannelIds = new Set(channels.map(c => c.id));
    channelCacheTime = Date.now();
  } catch {
    // If we can't fetch, use stale cache or empty set
    if (!knownChannelIds) knownChannelIds = new Set();
  }
  return knownChannelIds;
}

async function processMessage(message: ChannelMessage): Promise<void> {
  // Deduplicate: skip if we've already processed this message (persisted across SW restarts)
  if (!(await markProcessed(message.id))) {
    console.log(`[poller] Skipping duplicate message ${message.id.slice(0, 8)}`);
    return;
  }

  if (!messageHandler) {
    console.warn('No message handler registered for channel messages');
    return;
  }

  const settings = await getRelaySettings();
  if (!settings) return;

  const config = {
    serverUrl: settings.serverUrl,
    apiKey: settings.apiKey,
  };

  // Validate: skip messages for channels we don't have configured
  const known = await getKnownChannels(config);
  if (!known.has(message.channelId)) {
    console.log(`[poller] Skipping message for unknown/removed channel ${message.channelId.slice(0, 8)}`);
    broadcastChannelLog(`Skipped message for unconfigured channel ${message.channelId.slice(0, 8)}`);
    return;
  }

  broadcastChannelLog(`Processing message ${message.id.slice(0, 8)} from ${message.channelType}`);

  try {
    const responseContent = await messageHandler(message);
    if (responseContent) {
      // Only send reply for bidirectional channels
      const direction = message.metadata?.['channelDirection'] as string || 'bidirectional';
      if (direction === 'inbound') {
        broadcastChannelLog(`Processed inbound-only message ${message.id.slice(0, 8)} (no reply sent)`);
      } else {
        const reply: ChannelResponse = {
          channelType: message.channelType,
          channelId: message.channelId,
          replyTo: message.id,
          content: responseContent,
          metadata: message.metadata,
        };
        await sendReply(config, reply);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to process channel message ${message.id}:`, err);
    broadcastChannelLog(`Error processing message ${message.id.slice(0, 8)}: ${errMsg}`);
  } finally {
    // Persist processed IDs to survive SW restarts
    saveProcessedIds();
  }
}

/**
 * Start the WebSocket connection and adjust polling to fallback rate.
 */
export async function startWebSocket(): Promise<void> {
  const settings = await getRelaySettings();
  if (!settings) return;

  connectWebSocket(settings);

  // Slow down polling to fallback rate since WS handles the fast path
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: FALLBACK_INTERVAL_MINUTES,
    periodInMinutes: FALLBACK_INTERVAL_MINUTES,
  });
  console.log(`WebSocket connected — polling slowed to every ${FALLBACK_INTERVAL_MINUTES} min (fallback)`);
}

/**
 * Stop the WebSocket connection.
 */
export function stopWebSocket(): void {
  disconnectWebSocket();
}

export async function handlePollAlarm(): Promise<void> {
  const settings = await getRelaySettings();
  if (!settings) {
    // Not connected to a relay server
    return;
  }

  // If WebSocket is connected, skip polling — WS handles delivery
  if (isWebSocketConnected()) {
    broadcastChannelLog('Poll alarm fired — WebSocket is connected, skipping HTTP poll');
    // Attempt to reconnect WS if it's somehow marked connected but stale
    return;
  }

  // WebSocket is not connected — try to reconnect it
  broadcastChannelLog('WebSocket not connected — attempting reconnect and falling back to HTTP poll');
  connectWebSocket(settings);

  try {
    const config = {
      serverUrl: settings.serverUrl,
      apiKey: settings.apiKey,
    };

    // Poll for new messages
    broadcastChannelLog('Polling for new messages...');
    const result = await pollMessages(config, settings.lastPollTimestamp);

    // Update the timestamp for next poll
    await updateLastPollTimestamp(result.since);

    if (result.messages.length === 0) {
      broadcastChannelLog('Poll complete: no new messages');
      return;
    }

    console.log(`Channel poll: ${result.messages.length} new message(s)`);
    broadcastChannelLog(`Poll complete: ${result.messages.length} new message(s)`);

    // Process each message using shared handler
    for (const message of result.messages) {
      await processMessage(message);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Channel poll failed:', err);

    // If 401, server lost our session — auto-re-register
    if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
      broadcastChannelLog('Session expired. Re-registering...');
      try {
        const { userId, apiKey } = await registerWithRelay(settings.serverUrl);
        const newSettings = { ...settings, userId, apiKey };
        await setRelaySettings(newSettings);
        broadcastChannelLog(`Re-registered as ${userId.slice(0, 8)}... Reconnecting WebSocket...`);
        // Reconnect WebSocket with new credentials
        connectWebSocket(newSettings);
      } catch (reregErr) {
        const reregMsg = reregErr instanceof Error ? reregErr.message : String(reregErr);
        broadcastChannelLog(`Re-registration failed: ${reregMsg}`);
      }
    } else {
      broadcastChannelLog(`Poll failed: ${errMsg}`);
    }
  }
}
