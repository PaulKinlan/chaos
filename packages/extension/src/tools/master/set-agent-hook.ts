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
import { triggerSchema } from '../hooks/trigger-schema.js';

export function createSetAgentHookTool(_masterAgentId: string) {
  return tool({
    description:
      'Create a hook for a specific sub-agent. The hook fires when the specified browser event ' +
      'occurs and triggers the target agent (not the master). ' +
      'Trigger types: bookmark-created, tab-navigated, tab-created, tab-closed, ' +
      'download-completed, history-visited, idle-changed, browser-startup, omnibox, ' +
      'reading-list-changed, window-created, window-focused, window-closed, ' +
      'context-menu, clipboard-changed, filesystem-changed.',
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
