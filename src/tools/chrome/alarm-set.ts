/**
 * Alarm Set Tool
 *
 * Sets a Chrome alarm for scheduled agent work.
 * Alarm names are namespaced by agentId to prevent collisions.
 * When a prompt is provided, it is stored as a ScheduledTask so the
 * background service worker can execute a full agent loop when the alarm fires.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { addScheduledTask } from '../../storage/chrome-storage.js';
import type { ScheduledTask } from '../../storage/types.js';

export function createAlarmSet(agentId: string) {
  return tool({
    description:
      'Set a Chrome alarm for scheduling future work. The alarm name is automatically namespaced to this agent. ' +
      'Always include a `prompt` describing what you should do when the alarm fires — this prompt will be executed ' +
      'as a full agent task with access to all your tools.',
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
      prompt: z
        .string()
        .optional()
        .describe('The natural language prompt to execute when the alarm fires. This will run a full agent loop with all your tools.'),
      description: z
        .string()
        .optional()
        .describe('Human-readable description of what this scheduled task does (shown in the dashboard)'),
    }),
    execute: async ({ name, delayInMinutes, periodInMinutes, prompt, description }) => {
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

        // Store the scheduled task if a prompt was provided
        if (prompt) {
          const task: ScheduledTask = {
            alarmId: alarmName,
            agentId,
            prompt,
            description: description || name,
            createdAt: new Date().toISOString(),
            schedule: {
              type: periodInMinutes !== undefined ? 'recurring' : 'once',
              delayInMinutes,
              periodInMinutes,
            },
          };
          await addScheduledTask(task);
        }

        return { name: alarmName, delayInMinutes, periodInMinutes, prompt: prompt ? '(stored)' : undefined };
      } catch (err) {
        return {
          error: `Failed to set alarm: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
