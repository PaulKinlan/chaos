/**
 * Alarm List Tool
 *
 * Lists all Chrome alarms belonging to a specific agent,
 * enriched with scheduled task data (prompt, description, last run info).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getScheduledTasks } from '../../storage/chrome-storage.js';

export function createAlarmList(agentId: string) {
  return tool({
    description: "List all Chrome alarms set by this agent, including stored prompts and last run info.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const allAlarms = await chrome.alarms.getAll();
        const scheduledTasks = await getScheduledTasks();
        const prefix = `${agentId}:`;
        const agentAlarms = allAlarms
          .filter((alarm) => alarm.name.startsWith(prefix))
          .map((alarm) => {
            const task = scheduledTasks.find((t) => t.alarmId === alarm.name);
            return {
              name: alarm.name,
              scheduledTime: new Date(alarm.scheduledTime).toISOString(),
              periodInMinutes: alarm.periodInMinutes,
              prompt: task?.prompt,
              description: task?.description,
              lastRunAt: task?.lastRunAt,
              lastResult: task?.lastResult,
            };
          });
        return agentAlarms;
      } catch (err) {
        return {
          error: `Failed to list alarms: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
