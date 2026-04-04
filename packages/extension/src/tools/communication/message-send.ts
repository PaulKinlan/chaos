/**
 * Message Send Tool
 *
 * Send a message to another agent (or broadcast to all visible agents).
 * The 'from' agentId is injected by the tool factory.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendMessage } from '../../storage/shared.js';

export function createMessageSendTool(agentId: string) {
  return tool({
    description:
      'Send a message to another agent by ID, or broadcast to all visible agents. Messages are free-form text.',
    inputSchema: z.object({
      to: z
        .string()
        .describe("Target agent ID, or 'broadcast' to send to all visible agents"),
      body: z.string().describe('Message content (free-form text)'),
    }),
    execute: async ({ to, body }) => {
      const id = `msg-${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();

      await appendMessage({ id, from: agentId, to, timestamp, body });

      return { ok: true, messageId: id, to, timestamp };
    },
  });
}
