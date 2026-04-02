/**
 * Hook Tools Index
 *
 * Exports getHookTools(agentId) which returns all hook management tools.
 */

import type { ToolSet } from 'ai';
import { createHookCreate } from './hook-create.js';
import { createHookList } from './hook-list.js';
import { createHookDelete } from './hook-delete.js';

/**
 * Returns hook management tools scoped to the given agent.
 */
export function getHookTools(agentId: string): ToolSet {
  return {
    hook_create: createHookCreate(agentId),
    hook_list: createHookList(agentId),
    hook_delete: createHookDelete(agentId),
  };
}
