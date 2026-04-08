import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import type { Skill, SkillStore } from './types.js';

/**
 * Build a system prompt section from a list of skills.
 */
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const parts: string[] = ['\n---\n\n## Installed Skills\n'];

  for (const skill of skills) {
    parts.push(`### Skill: ${skill.name}\n`);
    if (skill.description) {
      parts.push(`> ${skill.description}\n`);
    }
    parts.push(skill.content);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Parse a SKILL.md file with YAML frontmatter into a Skill object.
 *
 * Expected format:
 * ```
 * ---
 * name: My Skill
 * description: Does things
 * author: Someone
 * version: 1.0.0
 * ---
 *
 * Skill content here...
 * ```
 */
export function parseSkillMd(content: string, id?: string): Skill {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!match) {
    // No frontmatter — treat entire content as the skill body
    const generatedId = id || 'unknown-skill';
    return {
      id: generatedId,
      name: generatedId,
      description: '',
      content: content.trim(),
    };
  }

  const frontmatter = match[1];
  const body = match[2];

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/^["']|["']$/g, '').trim();
    meta[key] = value;
  }

  const skillId =
    id ||
    meta.name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') ||
    'unknown-skill';

  return {
    id: skillId,
    name: meta.name || skillId,
    description: meta.description || '',
    content: body.trim(),
    author: meta.author,
    version: meta.version,
  };
}

/**
 * Create Vercel AI SDK tools for skill management.
 */
export function createSkillTools(store: SkillStore): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (schema: z.ZodType): any => schema;

  return {
    search_skills: tool({
      description:
        'Search for skills that can enhance your capabilities. Returns matching skills from the registry.',
      inputSchema: s(
        z.object({
          query: z
            .string()
            .describe('Search query for finding relevant skills'),
        }),
      ),
      execute: async ({ query }: { query: string }) => {
        const results = await store.search(query);
        if (results.length === 0) {
          return `No skills found matching "${query}"`;
        }
        return JSON.stringify(results, null, 2);
      },
    }),

    install_skill: tool({
      description: 'Install a skill by providing its full definition.',
      inputSchema: s(
        z.object({
          id: z.string().describe('Unique skill ID (kebab-case)'),
          name: z.string().describe('Human-readable skill name'),
          description: z.string().describe('What the skill does'),
          content: z.string().describe('The skill instructions/content'),
        }),
      ),
      execute: async ({
        id,
        name,
        description,
        content,
      }: {
        id: string;
        name: string;
        description: string;
        content: string;
      }) => {
        await store.install({ id, name, description, content });
        return `Skill "${name}" (${id}) installed successfully.`;
      },
    }),

    list_skills: tool({
      description: 'List all currently installed skills.',
      inputSchema: s(z.object({})),
      execute: async () => {
        const skills = await store.list();
        if (skills.length === 0) {
          return 'No skills installed.';
        }
        return skills
          .map((sk) => `- ${sk.name} (${sk.id}): ${sk.description}`)
          .join('\n');
      },
    }),

    remove_skill: tool({
      description: 'Remove an installed skill by ID.',
      inputSchema: s(
        z.object({
          skillId: z.string().describe('ID of the skill to remove'),
        }),
      ),
      execute: async ({ skillId }: { skillId: string }) => {
        const existing = await store.get(skillId);
        if (!existing) {
          return `Skill "${skillId}" not found.`;
        }
        await store.remove(skillId);
        return `Skill "${skillId}" removed.`;
      },
    }),
  };
}

/**
 * In-memory reference implementation of SkillStore.
 */
export class InMemorySkillStore implements SkillStore {
  private skills: Map<string, Skill> = new Map();

  async list(): Promise<Skill[]> {
    return Array.from(this.skills.values());
  }

  async get(skillId: string): Promise<Skill | undefined> {
    return this.skills.get(skillId);
  }

  async install(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
  }

  async remove(skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  async search(
    query: string,
  ): Promise<
    Array<{ id: string; name: string; description: string; url?: string }>
  > {
    const lower = query.toLowerCase();
    const results: Array<{
      id: string;
      name: string;
      description: string;
      url?: string;
    }> = [];
    for (const skill of this.skills.values()) {
      if (
        skill.name.toLowerCase().includes(lower) ||
        skill.description.toLowerCase().includes(lower) ||
        skill.content.toLowerCase().includes(lower)
      ) {
        results.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
        });
      }
    }
    return results;
  }
}
