/**
 * hook_delete tool
 *
 * Removes a hook by ID.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getHooks, removeHook } from '../../storage/chrome-storage.js';

export function createHookDelete(agentId: string) {
  return tool({
    description: 'Delete a hook by its ID. Only hooks belonging to this agent can be deleted.',
    inputSchema: z.object({
      hookId: z.string().describe('The ID of the hook to delete'),
    }),
    execute: async ({ hookId }) => {
      const allHooks = await getHooks();
      const hook = allHooks.find((h) => h.id === hookId);

      if (!hook) {
        return JSON.stringify({ success: false, error: `Hook not found: ${hookId}` });
      }

      if (hook.agentId !== agentId) {
        return JSON.stringify({ success: false, error: 'Cannot delete hooks belonging to other agents.' });
      }

      await removeHook(hookId);

      return JSON.stringify({
        success: true,
        message: `Hook deleted: "${hook.description}" (${hookId})`,
      });
    },
  });
}
