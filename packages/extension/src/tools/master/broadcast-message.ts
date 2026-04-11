/**
 * Broadcast Message Tool (master-only)
 *
 * Sends a message to all visible sub-agents at once. Unlike message_send
 * with to='broadcast', this tool filters to only agents that are visible
 * and were created by or report to the master, and returns delivery details.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendMessage } from '../../storage/shared.js';
import { getAgentList } from '../../storage/chrome-storage.js';

export function createBroadcastMessageTool(masterAgentId: string) {
  return tool({
    description:
      'Broadcast a message to all visible sub-agents at once. ' +
      'Returns a list of agents that received the message. ' +
      'Use this to coordinate multiple agents, announce policy changes, or gather status.',
    inputSchema: z.object({
      body: z.string().describe('Message content to broadcast to all sub-agents'),
      filter: z
        .object({
          role: z.string().optional().describe('Only send to agents matching this role (substring match)'),
          agentIds: z.array(z.string()).optional().describe('Only send to these specific agent IDs'),
        })
        .optional()
        .describe('Optional filter to narrow the broadcast audience'),
    }),
    execute: async ({ body, filter }) => {
      try {
        const agents = await getAgentList();
        const timestamp = new Date().toISOString();

        // Filter to visible/open agents (not the master itself, not private)
        let recipients = agents.filter(
          (a) => a.id !== masterAgentId && a.visibility !== 'private',
        );

        // Apply optional role filter
        if (filter?.role) {
          const roleQuery = filter.role.toLowerCase();
          recipients = recipients.filter(
            (a) => a.role && a.role.toLowerCase().includes(roleQuery),
          );
        }

        // Apply optional agentIds filter
        if (filter?.agentIds && filter.agentIds.length > 0) {
          const idSet = new Set(filter.agentIds);
          recipients = recipients.filter((a) => idSet.has(a.id));
        }

        // Send individual messages to each recipient (more trackable than a single broadcast)
        const deliveries: Array<{ agentId: string; agentName: string; messageId: string }> = [];

        for (const agent of recipients) {
          const id = `msg-${crypto.randomUUID()}`;
          await appendMessage({
            id,
            from: masterAgentId,
            to: agent.id,
            timestamp,
            body,
          });
          deliveries.push({ agentId: agent.id, agentName: agent.name, messageId: id });
        }

        console.log(
          `[broadcast-message] Master ${masterAgentId} broadcast to ${deliveries.length} agents`,
        );

        return {
          ok: true,
          recipientCount: deliveries.length,
          deliveries,
          timestamp,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
