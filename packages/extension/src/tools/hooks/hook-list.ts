/**
 * hook_list tool
 *
 * Lists hooks for the current agent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getHooks } from '../../storage/chrome-storage.js';

export function createHookList(agentId: string) {
  return tool({
    description:
      'List all hooks for this agent. Shows each hook\'s trigger, prompt, status, and stats.',
    inputSchema: z.object({}),
    execute: async () => {
      const allHooks = await getHooks();
      const myHooks = allHooks.filter((h) => h.agentId === agentId);

      if (myHooks.length === 0) {
        return JSON.stringify({ hooks: [], message: 'No hooks configured for this agent.' });
      }

      const summary = myHooks.map((h) => ({
        id: h.id,
        description: h.description,
        trigger: h.trigger,
        prompt: h.prompt.slice(0, 100) + (h.prompt.length > 100 ? '...' : ''),
        enabled: h.enabled,
        triggerCount: h.triggerCount,
        lastTriggeredAt: h.lastTriggeredAt || null,
        createdAt: h.createdAt,
      }));

      return JSON.stringify({ hooks: summary });
    },
  });
}
