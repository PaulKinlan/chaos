/**
 * Fetch Skill Tool
 *
 * Agent tool to fetch and install a skill from a URL.
 * Supports raw SKILL.md files and GitHub repository URLs.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { installSkill, parseFrontmatter } from '../../agents/skills.js';

/**
 * Try to fetch a SKILL.md from a GitHub repo URL.
 * Converts GitHub URLs to raw.githubusercontent.com URLs.
 */
async function fetchFromGitHub(url: string): Promise<{ content: string; source: string } | null> {
  // Match GitHub repo URLs like https://github.com/user/repo or https://github.com/user/repo/tree/main/path
  const repoMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/,
  );
  if (!repoMatch) return null;

  const [, owner, repo, branch = 'main', subpath = ''] = repoMatch;
  const basePath = subpath ? `${subpath}/` : '';

  // Try to fetch SKILL.md from the path
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${basePath}SKILL.md`;
  const response = await fetch(rawUrl);
  if (!response.ok) return null;

  const content = await response.text();
  return { content, source: url };
}

/**
 * Try to fetch a URL as a raw SKILL.md file.
 */
async function fetchRawSkill(url: string): Promise<{ content: string; source: string } | null> {
  const response = await fetch(url);
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') || '';
  const content = await response.text();

  // Accept markdown or plain text
  if (
    contentType.includes('text/markdown') ||
    contentType.includes('text/plain') ||
    url.endsWith('.md') ||
    content.startsWith('---') ||
    content.startsWith('#')
  ) {
    return { content, source: url };
  }

  return null;
}

export function createFetchSkillTool(agentId: string) {
  return tool({
    description:
      'Fetch and install a skill from a URL. Supports GitHub repository URLs (looks for SKILL.md) and direct URLs to markdown files.',
    inputSchema: z.object({
      url: z.string().url().describe('URL to fetch the skill from (GitHub repo URL or direct SKILL.md URL)'),
    }),
    execute: async ({ url }) => {
      try {
        // Try GitHub first, then raw URL
        let result = await fetchFromGitHub(url);
        if (!result) {
          result = await fetchRawSkill(url);
        }

        if (!result) {
          return JSON.stringify({
            success: false,
            error: `Could not fetch a skill from ${url}. Expected a SKILL.md file or a GitHub repository containing one.`,
          });
        }

        const { content, source } = result;
        const { meta } = parseFrontmatter(content);

        // Derive name from URL if not in frontmatter
        const urlName = url
          .replace(/^https?:\/\//, '')
          .replace(/github\.com\//, '')
          .split('/')
          .slice(0, 2)
          .join('/');

        const files = new Map<string, string>();
        files.set('SKILL.md', content);

        const skillId = await installSkill(
          agentId,
          {
            name: meta.name || urlName,
            description: meta.description || `Imported from ${source}`,
            author: meta.author,
            version: meta.version,
            source,
          },
          files,
        );

        return JSON.stringify({
          success: true,
          skillId,
          name: meta.name || urlName,
          message: `Skill installed from ${source}. It will be active in your next conversation.`,
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
