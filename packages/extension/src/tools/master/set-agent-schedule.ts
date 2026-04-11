/**
 * Set Agent Schedule Tool (master-only)
 *
 * Allows the master agent to create scheduled tasks for another agent.
 * Unlike alarm_set which is self-scoped, this tool lets the master
 * configure recurring work for any sub-agent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { addScheduledTask, getAgentList } from '../../storage/chrome-storage.js';
import type { ScheduledTask } from '../../storage/types.js';

export function createSetAgentScheduleTool(_masterAgentId: string) {
  return tool({
    description:
      'Set a scheduled task for a specific sub-agent. The task runs on a timer (one-time or recurring) ' +
      'and triggers the target agent with the given prompt. ' +
      'Use this to assign regular duties to sub-agents (e.g. daily summaries, periodic checks).',
    inputSchema: z.object({
      agentId: z
        .string()
        .describe('ID of the target agent that should execute the scheduled task'),
      name: z
        .string()
        .describe('Name for the schedule (will be prefixed with target agentId)'),
      prompt: z
        .string()
        .describe(
          'Natural language prompt the target agent will execute on each trigger',
        ),
      description: z
        .string()
        .describe(
          'Human-readable description of this scheduled task (shown in the dashboard)',
        ),
      delayInMinutes: z
        .number()
        .optional()
        .describe('Minutes from now until the first execution'),
      periodInMinutes: z
        .number()
        .optional()
        .describe('If set, the task repeats every this many minutes'),
    }),
    execute: async ({
      agentId,
      name,
      prompt,
      description,
      delayInMinutes,
      periodInMinutes,
    }) => {
      try {
        // Verify agent exists
        const agents = await getAgentList();
        const targetAgent = agents.find((a) => a.id === agentId);
        if (!targetAgent) {
          return {
            ok: false,
            error: `Agent '${agentId}' not found. Use find_agent to discover available agents.`,
          };
        }

        const alarmName = `${agentId}:${name}`;
        const alarmInfo: chrome.alarms.AlarmCreateInfo = {};

        if (delayInMinutes !== undefined) {
          alarmInfo.delayInMinutes = delayInMinutes;
        }
        if (periodInMinutes !== undefined) {
          alarmInfo.periodInMinutes = periodInMinutes;
        }
        if (delayInMinutes === undefined && periodInMinutes === undefined) {
          alarmInfo.delayInMinutes = 1;
        }

        await chrome.alarms.create(alarmName, alarmInfo);

        const task: ScheduledTask = {
          alarmId: alarmName,
          agentId, // Scoped to the target agent, not the master
          prompt,
          description,
          createdAt: new Date().toISOString(),
          schedule: {
            type: periodInMinutes !== undefined ? 'recurring' : 'once',
            delayInMinutes,
            periodInMinutes,
          },
        };
        await addScheduledTask(task);

        console.log(
          `[set-agent-schedule] Master created schedule '${name}' for agent ${agentId} (${task.schedule.type})`,
        );

        return {
          ok: true,
          alarmName,
          agentId,
          agentName: targetAgent.name,
          scheduleType: task.schedule.type,
          delayInMinutes,
          periodInMinutes,
          description,
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
