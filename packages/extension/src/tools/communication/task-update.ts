/**
 * Task Update Tool
 *
 * Update the status of a shared task.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendTaskEvent } from '../../storage/shared.js';

export function createTaskUpdateTool(_agentId: string) {
  return tool({
    description:
      'Update the status of a shared task. Use this to mark tasks as in progress, completed, or failed.',
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

      return { ok: true, taskId, status, timestamp };
    },
  });
}
