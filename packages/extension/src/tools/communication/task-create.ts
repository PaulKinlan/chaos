/**
 * Task Create Tool
 *
 * Create a shared task on the task board.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendTaskEvent, appendMessage } from '../../storage/shared.js';
import { listAgents } from '../../agents/manager.js';

export function createTaskCreateTool(_agentId: string) {
  return tool({
    description:
      'Create a new shared task on the task board. Tasks can have an owner and dependencies on other tasks.',
    inputSchema: z.object({
      subject: z.string().describe('Short title for the task'),
      description: z
        .string()
        .optional()
        .describe('Detailed description of what needs to be done'),
      owner: z
        .string()
        .optional()
        .describe('Agent ID to assign the task to'),
      blockedBy: z
        .array(z.string())
        .optional()
        .describe('Task IDs that must complete before this task can start'),
    }),
    execute: async ({ subject, description, owner, blockedBy }) => {
      const taskId = `task-${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();

      await appendTaskEvent({
        taskId,
        type: 'created',
        timestamp,
        data: {
          subject,
          description,
          owner,
          status: 'pending',
          blockedBy,
        },
      });

      // Notify agents about the new task
      try {
        const agents = await listAgents();
        const visibleAgents = agents.filter(a => a.visibility !== 'private' && a.id !== _agentId);

        if (owner) {
          // Direct assignment — trigger the assigned agent immediately
          chrome.runtime.sendMessage({
            type: 'executeAssignedTask',
            agentId: owner,
            taskId,
          });
        } else {
          // Unassigned job — broadcast to all visible agents so they can pick it up
          for (const agent of visibleAgents) {
            await appendMessage({
              id: crypto.randomUUID(),
              from: _agentId,
              to: agent.id,
              body: `New job posted to the board: "${subject}". Task ID: ${taskId}. ${description || ''}\n\nIf this matches your expertise, use task_update to set status to in_progress and start working on it.`,
              timestamp,
            });
          }
        }
      } catch {
        // Best-effort notification
      }

      return { ok: true, taskId, subject, timestamp };
    },
  });
}
