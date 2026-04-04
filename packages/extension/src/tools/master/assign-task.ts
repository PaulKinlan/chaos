/**
 * Assign Task Tool (master-only)
 *
 * Creates a task on the shared task board assigned to a sub-agent,
 * and triggers the sub-agent's agentic loop via a Chrome alarm.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { appendTaskEvent } from '../../storage/shared.js';
import { getAgent } from '../../agents/manager.js';

export function createAssignTaskTool(_masterAgentId: string) {
  return tool({
    description:
      'Create a task and assign it to a sub-agent. Also triggers the sub-agent\'s agentic loop to start working on it immediately via a Chrome alarm.',
    inputSchema: z.object({
      agentId: z.string().describe('ID of the agent to assign the task to'),
      description: z.string().describe('Short description of the task'),
      prompt: z.string().describe('Full prompt the sub-agent will execute'),
      blockedBy: z.array(z.string()).optional().describe('Task IDs that must complete first'),
    }),
    execute: async ({ agentId, description, prompt, blockedBy }) => {
      try {
        // Verify agent exists
        await getAgent(agentId);

        // Create task in shared board
        const taskId = `task-${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();

        await appendTaskEvent({
          taskId,
          type: 'created',
          timestamp,
          data: {
            subject: description,
            description: prompt,
            owner: agentId,
            status: 'pending',
            blockedBy,
          },
        });

        // Trigger the sub-agent's agentic loop via a Chrome alarm
        // that fires immediately (0.08 min = ~5 seconds, minimum allowed)
        const alarmName = `agentic:${agentId}:${taskId}`;
        try {
          await chrome.alarms.create(alarmName, { delayInMinutes: 0.08 });
        } catch {
          // Alarm API may not be available in tests
        }

        return {
          ok: true,
          taskId,
          agentId,
          assigned: true,
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
