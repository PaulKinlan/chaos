/**
 * Task List Tool
 *
 * List tasks from the shared task board, with optional filtering.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getTaskState, getUnblockedTasks } from '../../storage/shared.js';

export function createTaskListTool(_agentId: string) {
  return tool({
    description:
      'List tasks from the shared task board. Filter by agent, status, or show only unblocked tasks.',
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe('Filter tasks owned by this agent ID'),
      status: z
        .string()
        .optional()
        .describe('Filter by status: pending, in_progress, completed, failed'),
      unblockedOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, only return tasks that are not blocked by incomplete dependencies'),
    }),
    execute: async ({ agentId, status, unblockedOnly }) => {
      let tasks = unblockedOnly
        ? await getUnblockedTasks()
        : await getTaskState();

      if (agentId) {
        tasks = tasks.filter((t) => t.owner === agentId);
      }

      if (status) {
        tasks = tasks.filter((t) => t.status === status);
      }

      return tasks;
    },
  });
}
