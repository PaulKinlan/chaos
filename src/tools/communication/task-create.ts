/**
 * Task Create Tool
 *
 * Create a shared task on the task board.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendTaskEvent } from '../../storage/shared.js';

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

      return { ok: true, taskId, subject, timestamp };
    },
  });
}
