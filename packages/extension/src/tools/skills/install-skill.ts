/**
 * Install Skill Tool
 *
 * Agent tool to install a skill from pasted content.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { installSkill, parseFrontmatter } from '../../agents/skills.js';

export function createInstallSkillTool(agentId: string) {
  return tool({
    description:
      'Install a skill from provided SKILL.md content. Skills add specialised knowledge and instructions to your system prompt. Optionally include reference files for domain knowledge you can read later.',
    inputSchema: z.object({
      name: z.string().describe('Human-readable name for the skill'),
      description: z.string().describe('Brief description of what the skill provides'),
      content: z.string().describe('The SKILL.md content (markdown instructions)'),
      referenceFiles: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional map of relative paths to content for reference files (e.g. {"reference/topic.md": "content"})'),
    }),
    execute: async ({ name, description, content, referenceFiles }) => {
      try {
        // Parse frontmatter for additional metadata
        const { meta: fmMeta } = parseFrontmatter(content);

        const files = new Map<string, string>();
        files.set('SKILL.md', content);

        if (referenceFiles) {
          for (const [path, refContent] of Object.entries(referenceFiles)) {
            files.set(path, String(refContent));
          }
        }

        const skillId = await installSkill(
          agentId,
          {
            name: fmMeta.name || name,
            description: fmMeta.description || description,
            author: fmMeta.author,
            version: fmMeta.version,
          },
          files,
        );

        return JSON.stringify({
          success: true,
          skillId,
          message: `Skill "${fmMeta.name || name}" installed. It will be active in your next conversation.`,
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
