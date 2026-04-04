/**
 * Delete Agent Tool (master-only)
 *
 * Allows the master agent to remove a sub-agent. Cannot delete self.
 * Supports archival (preserveMemory=true) which removes the agent from
 * the active list but keeps OPFS storage for later restoration.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { deleteAgent, getAgent, archiveAgent } from '../../agents/manager.js';

export function createDeleteAgentTool(masterAgentId: string) {
  return tool({
    description:
      'Delete or archive a sub-agent. Cannot delete the master agent (self-protection). If preserveMemory is true (default), the agent is archived: removed from the active list but OPFS storage is preserved and can be restored later. If false, the agent and all its data are permanently deleted.',
    inputSchema: z.object({
      agentId: z.string().describe('ID of the agent to delete'),
      preserveMemory: z.boolean().optional().default(true).describe('If true, archives the agent (preserves data for later restoration). If false, permanently deletes all data.'),
    }),
    execute: async ({ agentId, preserveMemory }) => {
      // Self-protection: cannot delete the master agent
      if (agentId === masterAgentId) {
        return { ok: false, error: 'Cannot delete the master agent' };
      }

      try {
        // Verify agent exists
        await getAgent(agentId);

        if (preserveMemory) {
          // Archive: remove from active list, keep OPFS data
          await archiveAgent(agentId);
          return { ok: true, archived: true, preservedMemory: true };
        } else {
          // Full delete including OPFS
          await deleteAgent(agentId);
          return { ok: true, deleted: true, preservedMemory: false };
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
