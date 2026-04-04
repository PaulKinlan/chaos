/**
 * List Skills Tool
 *
 * Agent tool to list all installed skills.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listSkills } from '../../agents/skills.js';

export function createListSkillsTool(agentId: string) {
  return tool({
    description:
      'List all skills installed on this agent. Returns skill metadata including name, description, source, and installed date.',
    inputSchema: z.object({
      _unused: z.string().optional().describe('No input required'),
    }),
    execute: async () => {
      try {
        const skills = await listSkills(agentId);
        if (skills.length === 0) {
          return 'No skills installed.';
        }
        return JSON.stringify(skills, null, 2);
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
