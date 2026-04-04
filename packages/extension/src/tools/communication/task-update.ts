/**
 * Task Update Tool
 *
 * Update the status of a shared task.
 * When a task is completed, automatically checks for newly unblocked
 * tasks and triggers their assigned agents via Chrome alarms.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendTaskEvent, getNewlyUnblockedTasks } from '../../storage/shared.js';

export function createTaskUpdateTool(_agentId: string) {
  return tool({
    description:
      'Update the status of a shared task. Use this to mark tasks as in progress, completed, or failed. When a task completes, any downstream tasks that are now unblocked will be automatically triggered.',
    inputSchema: z.object({
      taskId: z.string().describe('ID of the task to update'),
      status: z
        .enum(['in_progress', 'completed', 'failed'])
        .describe('New status for the task'),
      result: z
        .string()
        .optional()
        .describe('Result or outcome description (useful when completing or failing)'),
    }),
    execute: async ({ taskId, status, result }) => {
      const timestamp = new Date().toISOString();

      await appendTaskEvent({
        taskId,
        type: 'updated',
        timestamp,
        data: { status, result },
      });

      // When a task completes, check for newly unblocked downstream tasks
      // and trigger their agents via Chrome alarms
      let triggered: string[] = [];
      if (status === 'completed') {
        try {
          const unblocked = await getNewlyUnblockedTasks(taskId);
          for (const task of unblocked) {
            if (task.owner) {
              const alarmName = `agentic:${task.owner}:${task.id}`;
              try {
                await chrome.alarms.create(alarmName, { delayInMinutes: 0.08 });
                triggered.push(task.id);
              } catch {
                // Alarm API may not be available in tests
              }
            }
          }
        } catch {
          // Non-fatal: unblocking check failed but the status update succeeded
        }
      }

      return { ok: true, taskId, status, timestamp, triggeredTasks: triggered };
    },
  });
}
