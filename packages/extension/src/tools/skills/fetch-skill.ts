/**
 * Fetch Skill Tool
 *
 * Agent tool to fetch and install a skill from a URL.
 * Uses the skill-fetcher module for proper GitHub API support,
 * reference file discovery, and frontmatter parsing.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { installSkill } from '../../agents/skills.js';
import { fetchSkillFromUrl } from '../../agents/skill-fetcher.js';

export function createFetchSkillTool(agentId: string) {
  return tool({
    description:
      'Fetch and install a skill from a URL. Supports GitHub repository URLs (uses GitHub API to find SKILL.md and reference files) and direct URLs to markdown files. GitHub repos are traversed to find SKILL.md files and reference/ directories automatically.',
    inputSchema: z.object({
      url: z.string().url().describe('URL to fetch the skill from (GitHub repo URL or direct SKILL.md URL)'),
    }),
    execute: async ({ url }) => {
      try {
        const fetched = await fetchSkillFromUrl(url);

        const skillId = await installSkill(
          agentId,
          {
            name: fetched.meta.name,
            description: fetched.meta.description,
            author: fetched.meta.author,
            version: fetched.meta.version,
            source: url,
          },
          fetched.files,
        );

        const refFileCount = fetched.files.size - 1; // minus SKILL.md
        return JSON.stringify({
          success: true,
          skillId,
          name: fetched.meta.name,
          description: fetched.meta.description,
          author: fetched.meta.author,
          version: fetched.meta.version,
          referenceFiles: refFileCount,
          message: `Skill "${fetched.meta.name}" installed with ${refFileCount} reference file(s). It will be active in your next conversation.`,
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
