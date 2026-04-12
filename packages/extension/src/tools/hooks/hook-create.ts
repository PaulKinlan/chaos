/**
 * hook_create tool
 *
 * Allows agents to create hooks from chat.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { addHook } from '../../storage/chrome-storage.js';
import type { Hook, HookTrigger } from '../../storage/types.js';
import { triggerSchema } from './trigger-schema.js';

export function createHookCreate(agentId: string) {
  return tool({
    description:
      'Create a hook that automatically runs this agent when a browser event occurs. ' +
      'Trigger types: bookmark-created, tab-navigated, tab-created, tab-closed, ' +
      'download-completed, history-visited, idle-changed, browser-startup, omnibox, ' +
      'reading-list-changed, window-created, window-focused, window-closed, ' +
      'context-menu, clipboard-changed, filesystem-changed.',
    inputSchema: z.object({
      trigger: triggerSchema.describe('The event trigger configuration'),
      prompt: z.string().describe('What the agent should do when the hook fires'),
      description: z.string().describe('Human-readable description of this hook'),
    }),
    execute: async ({ trigger, prompt, description }) => {
      const hook: Hook = {
        id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId,
        trigger: trigger as HookTrigger,
        prompt,
        description,
        enabled: true,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
      };

      await addHook(hook);

      return JSON.stringify({
        success: true,
        hookId: hook.id,
        message: `Hook created: "${description}" (trigger: ${trigger.type})`,
      });
    },
  });
}
