/**
 * Message Read Tool
 *
 * Read messages addressed to this agent (or broadcast).
 * The agentId is injected by the tool factory.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getMessages } from '../../storage/shared.js';

export function createMessageReadTool(agentId: string) {
  return tool({
    description:
      'Read messages sent to you (including broadcasts). Optionally filter by time and limit the number of results.',
    parameters: z.object({
      since: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp — only return messages on or after this time'),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe('Maximum number of messages to return (default 20, from most recent)'),
    }),
    execute: async ({ since, limit }) => {
      const allMessages = await getMessages({ since, limit: undefined });

      // Filter to messages addressed to this agent or broadcast
      let filtered = allMessages.filter(
        (m) => m.to === agentId || m.to === 'broadcast',
      );

      if (limit !== undefined && limit > 0) {
        filtered = filtered.slice(-limit);
      }

      return filtered;
    },
  });
}
