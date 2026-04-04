/**
 * Remove Skill Tool
 *
 * Agent tool to remove an installed skill.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { removeSkill } from '../../agents/skills.js';

export function createRemoveSkillTool(agentId: string) {
  return tool({
    description:
      'Remove an installed skill by its ID. This deletes the skill files and removes it from the manifest.',
    inputSchema: z.object({
      skillId: z.string().describe('The ID of the skill to remove'),
    }),
    execute: async ({ skillId }) => {
      try {
        await removeSkill(agentId, skillId);
        return JSON.stringify({
          success: true,
          message: `Skill "${skillId}" removed.`,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
