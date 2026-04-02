/**
 * Alarm Clear Tool
 *
 * Clears a Chrome alarm by name, namespaced to the agent.
 * Also removes the associated ScheduledTask from storage.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { removeScheduledTask } from '../../storage/chrome-storage.js';

export function createAlarmClear(agentId: string) {
  return tool({
    description: 'Clear a previously set Chrome alarm by name. Also removes the associated scheduled task.',
    parameters: z.object({
      name: z.string().describe('Name of the alarm to clear (will be prefixed with agentId)'),
    }),
    execute: async ({ name }) => {
      try {
        const alarmName = `${agentId}:${name}`;
        const wasCleared = await chrome.alarms.clear(alarmName);
        // Remove the scheduled task from storage
        await removeScheduledTask(alarmName);
        return { name: alarmName, cleared: wasCleared };
      } catch (err) {
        return {
          error: `Failed to clear alarm: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
