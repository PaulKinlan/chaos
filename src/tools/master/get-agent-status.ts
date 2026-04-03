/**
 * Get Agent Status Tool (master-only)
 *
 * Reads an agent's metadata, recent activity, and pending tasks.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getAgent } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';
import { getTaskState } from '../../storage/shared.js';

const AGENTS_ROOT = 'agents';
const ACTIVITY_LOG = 'activity-log.jsonl';

export function createGetAgentStatusTool(_masterAgentId: string) {
  return tool({
    description:
      'Check on a sub-agent\'s current status: metadata, recent activity, and pending tasks.',
    inputSchema: z.object({
      agentId: z.string().describe('ID of the agent to check'),
    }),
    execute: async ({ agentId }) => {
      try {
        const { meta } = await getAgent(agentId);

        // Read recent activity
        const recentActions: string[] = [];
        try {
          const lines = await opfs.readLines(
            `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`,
            10,
          );
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              recentActions.push(
                `[${entry.timestamp}] ${entry.role}: ${entry.summary}`,
              );
            } catch {
              // Skip malformed lines
            }
          }
        } catch {
          // No activity log yet
        }

        // Get pending tasks
        const allTasks = await getTaskState();
        const pendingTasks = allTasks.filter(
          (t) =>
            t.owner === agentId &&
            (t.status === 'pending' || t.status === 'in_progress'),
        );

        // Find last activity timestamp
        let lastActivity: string | undefined;
        if (recentActions.length > 0) {
          const lastLine = recentActions[recentActions.length - 1];
          const match = lastLine.match(/\[(.+?)\]/);
          if (match) lastActivity = match[1];
        }

        return {
          ok: true,
          name: meta.name,
          role: meta.role,
          visibility: meta.visibility,
          temporary: meta.temporary ?? false,
          createdBy: meta.createdBy,
          lastActivity: lastActivity ?? 'no activity recorded',
          pendingTasks: pendingTasks.length,
          pendingTaskDetails: pendingTasks.map((t) => ({
            id: t.id,
            subject: t.subject,
            status: t.status,
          })),
          recentActions,
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
