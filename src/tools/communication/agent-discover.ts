/**
 * Agent Discover Tool
 *
 * List other agents that are visible to this agent.
 * Filters out private agents and the calling agent itself.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getAgentList } from '../../storage/chrome-storage.js';

export function createAgentDiscoverTool(agentId: string) {
  return tool({
    description:
      'Discover other agents that are visible or open. Returns their ID, name, role, and visibility. Private agents are excluded.',
    parameters: z.object({}),
    execute: async () => {
      const agents = await getAgentList();

      return agents
        .filter((a) => a.id !== agentId && a.visibility !== 'private')
        .map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          visibility: a.visibility,
        }));
    },
  });
}
