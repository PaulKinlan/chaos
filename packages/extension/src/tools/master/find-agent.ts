/**
 * Find Agent Tool
 *
 * Searches agents by role or name (case-insensitive partial match).
 * Available to all agents, not just master.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listAgents } from '../../agents/manager.js';

export function createFindAgentTool(_agentId: string) {
  return tool({
    description:
      'Search for agents by role or name. Returns matching agents with their metadata. Case-insensitive partial match.',
    inputSchema: z.object({
      role: z.string().optional().describe('Role to search for (partial match)'),
      name: z.string().optional().describe('Name to search for (partial match)'),
    }),
    execute: async ({ role, name }) => {
      try {
        let agents = await listAgents();

        if (role) {
          const lowerRole = role.toLowerCase();
          agents = agents.filter((a) =>
            a.role.toLowerCase().includes(lowerRole),
          );
        }

        if (name) {
          const lowerName = name.toLowerCase();
          agents = agents.filter((a) =>
            a.name.toLowerCase().includes(lowerName),
          );
        }

        return {
          ok: true,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            visibility: a.visibility,
            master: a.master ?? false,
            temporary: a.temporary ?? false,
            createdBy: a.createdBy,
            createdAt: a.createdAt,
            provider: a.provider ?? null,
            model: a.model ?? null,
          })),
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
