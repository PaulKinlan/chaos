/**
 * Auto Install Skill Tool
 *
 * Agent tool that wraps fetch + install in one step.
 * Given a URL, fetches the skill and installs it on the current
 * agent (or a specified agent).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { installSkill } from '../../agents/skills.js';
import { fetchSkillFromUrl } from '../../agents/skill-fetcher.js';

export function createAutoInstallSkillTool(agentId: string) {
  return tool({
    description:
      'Fetch and install a skill in one step. Provide a URL to a GitHub repository or SKILL.md file, and it will be fetched, parsed, and installed on this agent (or a specified agent). Use this after search_skills to quickly install a discovered skill.',
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe(
          'URL of a skill repository or SKILL.md file to fetch and install',
        ),
      agentId: z
        .string()
        .optional()
        .describe(
          'Agent ID to install the skill on. Defaults to the current agent.',
        ),
    }),
    execute: async ({ url, agentId: targetAgentId }) => {
      try {
        const targetId = targetAgentId || agentId;

        // Fetch the skill from the URL
        const fetched = await fetchSkillFromUrl(url);

        // Install it
        const skillId = await installSkill(
          targetId,
          {
            name: fetched.meta.name,
            description: fetched.meta.description,
            author: fetched.meta.author,
            version: fetched.meta.version,
            source: url,
          },
          fetched.files,
        );

        return JSON.stringify({
          ok: true,
          skillId,
          name: fetched.meta.name,
          fileCount: fetched.files.size,
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
