/**
 * hook_create tool
 *
 * Allows agents to create hooks from chat.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { addHook } from '../../storage/chrome-storage.js';
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
  z.object({
    type: z.literal('tab-created'),
  }),
  z.object({
    type: z.literal('tab-closed'),
  }),
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
  z.object({
    type: z.literal('browser-startup'),
  }),
  z.object({
    type: z.literal('omnibox'),
    keyword: z.string(),
  }),
]);

export function createHookCreate(agentId: string) {
  return tool({
    description:
      'Create a hook that automatically runs this agent when a browser event occurs. ' +
      'Hooks let you respond to bookmarks being created, tab navigation, downloads completing, ' +
      'browser startup, omnibox input, and more.',
    parameters: z.object({
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
