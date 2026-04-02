/**
 * Alarm Set Tool
 *
 * Sets a Chrome alarm for scheduled agent work.
 * Alarm names are namespaced by agentId to prevent collisions.
 */

import { tool } from 'ai';
import { z } from 'zod';

export function createAlarmSet(agentId: string) {
  return tool({
    description:
      'Set a Chrome alarm for scheduling future work. The alarm name is automatically namespaced to this agent.',
    parameters: z.object({
      name: z.string().describe('Name for the alarm (will be prefixed with agentId)'),
      delayInMinutes: z
        .number()
        .optional()
        .describe('Minutes from now until the alarm fires'),
      periodInMinutes: z
        .number()
        .optional()
        .describe('If set, the alarm repeats every this many minutes'),
    }),
    execute: async ({ name, delayInMinutes, periodInMinutes }) => {
      try {
        const alarmName = `${agentId}:${name}`;
        const alarmInfo: chrome.alarms.AlarmCreateInfo = {};
        if (delayInMinutes !== undefined) {
          alarmInfo.delayInMinutes = delayInMinutes;
        }
        if (periodInMinutes !== undefined) {
          alarmInfo.periodInMinutes = periodInMinutes;
        }
        // If neither delay nor period, default to 1 minute delay
        if (delayInMinutes === undefined && periodInMinutes === undefined) {
          alarmInfo.delayInMinutes = 1;
        }
        await chrome.alarms.create(alarmName, alarmInfo);
        return { name: alarmName, delayInMinutes, periodInMinutes };
      } catch (err) {
        return {
          error: `Failed to set alarm: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
