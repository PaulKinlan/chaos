/**
 * Search Skills Tool
 *
 * Agent tool to search for skills from multiple sources:
 * 1. Curated featured skills list
 * 2. GitHub search API (repos with SKILL.md or .agents/skills)
 * 3. Already installed skills on this agent
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listSkills } from '../../agents/skills.js';
import { FEATURED_SKILLS } from '../../agents/featured-skills.js';

interface SkillSearchResult {
  name: string;
  description: string;
  author: string;
  source: string;
  installed: boolean;
}

interface GitHubSearchItem {
  full_name: string;
  html_url: string;
  description: string | null;
  owner: { login: string };
}

/**
 * Search GitHub for repos likely to contain skills.
 */
async function searchGitHub(query: string): Promise<SkillSearchResult[]> {
  const results: SkillSearchResult[] = [];

  // Search for repos containing SKILL.md or .agents/skills related to the query
  const searchQueries = [
    `${query} SKILL.md in:readme,name,description`,
    `${query} agents skills in:readme,name,description`,
  ];

  for (const q of searchQueries) {
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5&sort=stars&order=desc`;
      const resp = await fetch(url, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as { items: GitHubSearchItem[] };
      if (!data.items) continue;

      for (const item of data.items) {
        // Avoid duplicates
        if (results.some((r) => r.source === item.html_url)) continue;

        results.push({
          name: item.full_name,
          description: item.description || 'No description',
          author: item.owner.login,
          source: item.html_url,
          installed: false,
        });
      }
    } catch {
      // GitHub API errors are non-fatal; continue with other sources
    }
  }

  return results;
}

export function createSearchSkillsTool(agentId: string) {
  return tool({
    description:
      'Search for skills from multiple sources: curated featured skills, GitHub repositories with SKILL.md files, and already-installed skills on this agent. Returns matching skills with name, description, author, source URL, and whether they are already installed.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Search term to find skills (e.g. "frontend design", "code review", "accessibility")',
        ),
    }),
    execute: async ({ query }) => {
      try {
        const queryLower = query.toLowerCase();
        const results: SkillSearchResult[] = [];

        // 1. Search installed skills
        const installed = await listSkills(agentId);
        const installedSources = new Set(
          installed.map((s) => s.source).filter(Boolean),
        );

        for (const skill of installed) {
          const match =
            skill.name.toLowerCase().includes(queryLower) ||
            skill.description.toLowerCase().includes(queryLower);
          if (match) {
            results.push({
              name: skill.name,
              description: skill.description,
              author: skill.author || 'unknown',
              source: skill.source || 'local',
              installed: true,
            });
          }
        }

        // 2. Search featured skills
        for (const skill of FEATURED_SKILLS) {
          const match =
            skill.name.toLowerCase().includes(queryLower) ||
            skill.description.toLowerCase().includes(queryLower) ||
            skill.author.toLowerCase().includes(queryLower);
          if (match) {
            // Check if already installed
            const isInstalled = installedSources.has(skill.url);
            // Avoid duplicates from installed search
            if (!results.some((r) => r.source === skill.url)) {
              results.push({
                name: skill.name,
                description: skill.description,
                author: skill.author,
                source: skill.url,
                installed: isInstalled,
              });
            }
          }
        }

        // 3. Search GitHub
        const githubResults = await searchGitHub(query);
        for (const result of githubResults) {
          // Check if already in results or already installed
          if (results.some((r) => r.source === result.source)) continue;
          result.installed = installedSources.has(result.source);
          results.push(result);
        }

        return JSON.stringify({
          query,
          resultCount: results.length,
          results,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
