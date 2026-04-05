/**
 * Channel Send Tool
 *
 * Send a message to a configured external channel (Telegram, Discord, Email, Webhook, Filesystem).
 * Can send proactively without an incoming message.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getRelaySettings } from '../../channels/config.js';
import { listChannels, sendReply } from '../../channels/relay-client.js';
import type { ChannelConfig } from '../../channels/types.js';

export function createChannelSendTool(_agentId: string) {
  return tool({
    description:
      'Send a message to a configured external channel (Telegram, Discord, Email, Webhook, Filesystem). Can send proactively without an incoming message.',
    inputSchema: z.object({
      channelName: z
        .string()
        .optional()
        .describe('Match channel by name'),
      channelType: z
        .string()
        .optional()
        .describe('Filter by channel type (telegram, discord, email, webhook, filesystem)'),
      content: z.string().describe('The message content to send'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Channel-specific metadata (e.g. { subject: "..." } for email, { action: "write", path: "..." } for filesystem)',
        ),
    }),
    execute: async ({ channelName, channelType, content, metadata }) => {
      // Load relay settings
      const relaySettings = await getRelaySettings();
      if (!relaySettings) {
        return { ok: false, error: 'Relay not configured. Register with a relay server first.' };
      }

      const relayConfig = {
        serverUrl: relaySettings.serverUrl,
        apiKey: relaySettings.apiKey,
      };

      // Handle filesystem channels locally
      if (channelType === 'filesystem') {
        return {
          ok: false,
          error: 'Filesystem channels are not yet supported via channel_send. Use local file tools instead.',
        };
      }

      // List channels from relay
      let channels: ChannelConfig[];
      try {
        channels = await listChannels(relayConfig);
      } catch (err) {
        return { ok: false, error: `Failed to list channels: ${err instanceof Error ? err.message : String(err)}` };
      }

      // Find matching channel
      let match: ChannelConfig | undefined;

      if (channelName) {
        match = channels.find(
          (c) => c.name?.toLowerCase() === channelName.toLowerCase() && c.enabled,
        );
      }

      if (!match && channelType) {
        match = channels.find(
          (c) => c.type === channelType && c.enabled,
        );
      }

      if (!match && !channelName && !channelType) {
        // If neither specified, pick the first enabled channel
        match = channels.find((c) => c.enabled);
      }

      if (!match) {
        const available = channels
          .filter((c) => c.enabled)
          .map((c) => `${c.name || c.id} (${c.type})`)
          .join(', ');
        return {
          ok: false,
          error: `No matching channel found. Available channels: ${available || 'none'}`,
        };
      }

      // Check direction — only bidirectional channels support sending
      const direction = match.direction || (match.type === 'webhook' ? 'inbound' : 'bidirectional');
      if (direction === 'inbound') {
        return {
          ok: false,
          error: `Channel "${match.name || match.type}" is inbound-only (${match.type}) and does not support outbound messages. Only bidirectional channels (Telegram, Discord, Email) support sending.`,
        };
      }

      // Send via relay
      try {
        await sendReply(relayConfig, {
          channelType: match.type,
          channelId: match.id,
          content,
          metadata: metadata as Record<string, unknown> | undefined,
        });
      } catch (err) {
        return {
          ok: false,
          error: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return {
        ok: true,
        channelId: match.id,
        channelType: match.type,
        channelName: match.name || match.id,
      };
    },
  });
}
