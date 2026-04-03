/**
 * Delete Agent Tool (master-only)
 *
 * Allows the master agent to remove a sub-agent. Cannot delete self.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { deleteAgent, getAgent } from '../../agents/manager.js';

export function createDeleteAgentTool(masterAgentId: string) {
  return tool({
    description:
      'Delete a sub-agent. Cannot delete the master agent (self-protection). If preserveMemory is false, also deletes OPFS storage.',
    inputSchema: z.object({
      agentId: z.string().describe('ID of the agent to delete'),
      preserveMemory: z.boolean().optional().default(true).describe('If true, keeps OPFS storage for reference'),
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
          // Remove from agent list but keep OPFS storage
          // We need to do a partial delete: remove from Chrome storage only
          const { getAgentList, setAgentList } = await import('../../storage/chrome-storage.js');
          const agents = await getAgentList();
          const agent = agents.find((a) => a.id === agentId);
          if (agent?.bookmarkFolderId) {
            try {
              await chrome.bookmarks.removeTree(agent.bookmarkFolderId);
            } catch {
              // Bookmark folder may already be gone
            }
          }
          const updated = agents.filter((a) => a.id !== agentId);
          await setAgentList(updated);
        } else {
          // Full delete including OPFS
          await deleteAgent(agentId);
        }

        return { ok: true, deleted: true, preservedMemory: preserveMemory };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
