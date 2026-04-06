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
  // ── Anthropic Official Skills ──
  {
    name: 'Frontend Design',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    description: 'Build beautiful, accessible web interfaces with modern CSS and responsive design',
  },
  {
    name: 'Web Artifacts Builder',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder',
    description: 'Create interactive web artifacts with HTML, CSS, and JavaScript',
  },
  {
    name: 'Canvas Design',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/canvas-design',
    description: 'Design and create HTML Canvas-based graphics and animations',
  },
  {
    name: 'Algorithmic Art',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/algorithmic-art',
    description: 'Create generative art using algorithms and mathematical patterns',
  },
  {
    name: 'Theme Factory',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/theme-factory',
    description: 'Design and generate consistent color themes and design systems',
  },
  {
    name: 'Doc Co-authoring',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring',
    description: 'Collaborate on document writing with structured editing and review',
  },
  {
    name: 'Internal Comms',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/internal-comms',
    description: 'Draft professional internal communications, memos, and announcements',
  },
  {
    name: 'Brand Guidelines',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/brand-guidelines',
    description: 'Create and maintain brand guidelines and style documentation',
  },
  {
    name: 'MCP Builder',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/mcp-builder',
    description: 'Build Model Context Protocol servers and integrations',
  },
  {
    name: 'Claude API',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/claude-api',
    description: 'Work with the Anthropic Claude API — prompts, tools, and best practices',
  },
  {
    name: 'Skill Creator',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
    description: 'Create new skills with proper structure, frontmatter, and reference material',
  },
  {
    name: 'WebApp Testing',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    description: 'Test web applications with automated testing strategies',
  },
  {
    name: 'PDF',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
    description: 'Generate and manipulate PDF documents',
  },
  {
    name: 'DOCX',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/docx',
    description: 'Generate Microsoft Word documents',
  },
  {
    name: 'PPTX',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/pptx',
    description: 'Generate PowerPoint presentations',
  },
  {
    name: 'XLSX',
    author: 'anthropics',
    url: 'https://github.com/anthropics/skills/tree/main/skills/xlsx',
    description: 'Generate Excel spreadsheets',
  },
  // ── Community Skills ──
  {
    name: 'Frontend Design (Impeccable)',
    author: 'pbakaus',
    url: 'https://github.com/pbakaus/impeccable',
    description: 'Design vocabulary and audit commands for frontend work',
  },
  {
    name: 'Cursor Rules Collection',
    author: 'PatrickJS',
    url: 'https://github.com/PatrickJS/awesome-cursorrules',
    description: 'Curated list of cursor rules and AI coding skills',
  },
];
