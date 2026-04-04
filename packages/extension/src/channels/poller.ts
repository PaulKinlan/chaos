// Channel polling via Chrome alarms
// Periodically checks the relay server for new messages

import { getRelaySettings, updateLastPollTimestamp } from './config.js';
import { pollMessages, sendReply } from './relay-client.js';
import type { ChannelMessage, ChannelResponse } from './types.js';

const ALARM_NAME = 'chaos-channel-poll';
const DEFAULT_INTERVAL_MINUTES = 1;

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
}

export async function handlePollAlarm(): Promise<void> {
  const settings = await getRelaySettings();
  if (!settings) {
    // Not connected to a relay server
    return;
  }

  try {
    const config = {
      serverUrl: settings.serverUrl,
      apiKey: settings.apiKey,
    };

    // Poll for new messages
    const result = await pollMessages(config, settings.lastPollTimestamp);

    // Update the timestamp for next poll
    await updateLastPollTimestamp(result.since);

    if (result.messages.length === 0) return;

    console.log(`Channel poll: ${result.messages.length} new message(s)`);

    // Process each message
    for (const message of result.messages) {
      if (!messageHandler) {
        console.warn('No message handler registered for channel messages');
        continue;
      }

      try {
        const responseContent = await messageHandler(message);
        if (responseContent) {
          const reply: ChannelResponse = {
            channelType: message.channelType,
            channelId: message.channelId,
            replyTo: message.id,
            content: responseContent,
          };
          await sendReply(config, reply);
        }
      } catch (err) {
        console.error(`Failed to process channel message ${message.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Channel poll failed:', err);
  }
}
