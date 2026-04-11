/**
 * Set Agent Hook Tool (master-only)
 *
 * Allows the master agent to create hooks on behalf of another agent.
 * Unlike hook_create which is self-scoped, this tool lets the master
 * configure any sub-agent's automation.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { addHook, getAgentList } from '../../storage/chrome-storage.js';
import type { Hook, HookTrigger } from '../../storage/types.js';

const triggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bookmark-created'),
    folderId: z.string().optional(),
    folderName: z.string().optional(),
  }),
  z.object({
    type: z.literal('tab-navigated'),
    urlPattern: z.string(),
  }),
  z.object({ type: z.literal('tab-created') }),
  z.object({ type: z.literal('tab-closed') }),
  z.object({
    type: z.literal('download-completed'),
    filenamePattern: z.string().optional(),
  }),
  z.object({
    type: z.literal('history-visited'),
    urlPattern: z.string(),
  }),
  z.object({
    type: z.literal('idle-changed'),
    state: z.enum(['active', 'idle', 'locked']),
  }),
  z.object({ type: z.literal('browser-startup') }),
  z.object({
    type: z.literal('omnibox'),
    keyword: z.string(),
  }),
]);

export function createSetAgentHookTool(_masterAgentId: string) {
  return tool({
    description:
      'Create a hook for a specific sub-agent. The hook fires when the specified browser event ' +
      'occurs and triggers the target agent (not the master). ' +
      'Use this to set up automations for sub-agents without them needing to do it themselves.',
    inputSchema: z.object({
      agentId: z
        .string()
        .describe('ID of the target agent that should handle the hook'),
      trigger: triggerSchema.describe('The browser event trigger configuration'),
      prompt: z
        .string()
        .describe('What the target agent should do when the hook fires'),
      description: z
        .string()
        .describe('Human-readable description of this hook'),
    }),
    execute: async ({ agentId, trigger, prompt, description }) => {
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

        const hook: Hook = {
          id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          agentId, // Scoped to the target agent, not the master
          trigger: trigger as HookTrigger,
          prompt,
          description,
          enabled: true,
          createdAt: new Date().toISOString(),
          triggerCount: 0,
        };

        await addHook(hook);

        console.log(
          `[set-agent-hook] Master created hook '${description}' for agent ${agentId} (${trigger.type})`,
        );

        return {
          ok: true,
          hookId: hook.id,
          agentId,
          agentName: targetAgent.name,
          trigger: trigger.type,
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
