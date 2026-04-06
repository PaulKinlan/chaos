/**
 * Featured Skills
 *
 * Curated list of recommended skills, shared between the UI (app.ts)
 * and agent tools (search_skills).
 */

export interface FeaturedSkill {
  name: string;
  author: string;
  url: string;
  description: string;
}

export const FEATURED_SKILLS: FeaturedSkill[] = [
  {
    name: 'Frontend Design (Impeccable)',
    author: 'pbakaus',
    url: 'https://github.com/pbakaus/impeccable',
    description: 'Design vocabulary and audit commands for frontend work',
  },
  {
    name: 'Claude Code Best Practices',
    author: 'anthropics',
    url: 'https://github.com/anthropics/claude-code-best-practices',
    description: 'Best practices for working with Claude Code',
  },
  {
    name: 'Cursor Rules Collection',
    author: 'PatrickJS',
    url: 'https://github.com/PatrickJS/awesome-cursorrules',
    description: 'Curated list of cursor rules and AI coding skills',
  },
  {
    name: 'AI Prompts Collection',
    author: 'f',
    url: 'https://github.com/f/awesome-chatgpt-prompts',
    description: 'Collection of useful prompt patterns and techniques',
  },
];
