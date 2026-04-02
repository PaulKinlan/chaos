/**
 * Alarm List Tool
 *
 * Lists all Chrome alarms belonging to a specific agent.
 */

import { tool } from 'ai';
import { z } from 'zod';

export function createAlarmList(agentId: string) {
  return tool({
    description: "List all Chrome alarms set by this agent.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const allAlarms = await chrome.alarms.getAll();
        const prefix = `${agentId}:`;
        const agentAlarms = allAlarms
          .filter((alarm) => alarm.name.startsWith(prefix))
          .map((alarm) => ({
            name: alarm.name,
            scheduledTime: new Date(alarm.scheduledTime).toISOString(),
            periodInMinutes: alarm.periodInMinutes,
          }));
        return agentAlarms;
      } catch (err) {
        return {
          error: `Failed to list alarms: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
