// Channel polling via Chrome alarms
// Periodically checks the relay server for new messages
// WebSocket provides the fast path; alarm polling is the reliable fallback

import { getRelaySettings, setRelaySettings, updateLastPollTimestamp } from './config.js';
import { pollMessages, sendReply, registerWithRelay } from './relay-client.js';
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
async function processMessage(message: ChannelMessage): Promise<void> {
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

  try {
    const responseContent = await messageHandler(message);
    if (responseContent) {
      const reply: ChannelResponse = {
        channelType: message.channelType,
        channelId: message.channelId,
        replyTo: message.id,
        content: responseContent,
        metadata: message.metadata,
      };
      await sendReply(config, reply);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to process channel message ${message.id}:`, err);
    broadcastChannelLog(`Error processing message ${message.id.slice(0, 8)}: ${errMsg}`);
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
