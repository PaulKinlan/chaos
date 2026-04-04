/**
 * Skills Module
 *
 * CRUD operations for agent skills stored in OPFS.
 * Skills are bundles of instructions (SKILL.md) and optional reference
 * material that get injected into an agent's system prompt.
 */

import { opfs } from '../storage/opfs.js';

// ── Types ──

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  source?: string;
  installedAt: string;
  files: string[];  // relative paths within the skill directory
}

// ── Constants ──

const AGENTS_ROOT = 'agents';
const SKILLS_DIR = 'skills';
const MANIFEST_FILE = 'skill-manifest.json';

// ── Helpers ──

function skillsRoot(agentId: string): string {
  return `${AGENTS_ROOT}/${agentId}/${SKILLS_DIR}`;
}

function manifestPath(agentId: string): string {
  return `${skillsRoot(agentId)}/${MANIFEST_FILE}`;
}

function skillDir(agentId: string, skillId: string): string {
  return `${skillsRoot(agentId)}/${skillId}`;
}

/** Generate a kebab-case ID from a skill name. */
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns extracted metadata fields and the body content (without frontmatter).
 */
export function parseFrontmatter(content: string): {
  meta: Partial<Pick<SkillMeta, 'name' | 'description' | 'author' | 'version'>>;
  body: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const frontmatter = match[1];
  const body = match[2];
  const meta: Partial<Pick<SkillMeta, 'name' | 'description' | 'author' | 'version'>> = {};

  // Simple YAML key-value parser (no nested objects)
  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/^["']|["']$/g, '').trim();
    switch (key) {
      case 'name':
        meta.name = value;
        break;
      case 'description':
        meta.description = value;
        break;
      case 'author':
        meta.author = value;
        break;
      case 'version':
        meta.version = value;
        break;
    }
  }

  return { meta, body };
}

// ── Manifest operations ──

async function readManifest(agentId: string): Promise<SkillMeta[]> {
  try {
    const raw = await opfs.readFile(manifestPath(agentId));
    return JSON.parse(raw) as SkillMeta[];
  } catch {
    return [];
  }
}

async function writeManifest(agentId: string, manifest: SkillMeta[]): Promise<void> {
  await opfs.writeFile(manifestPath(agentId), JSON.stringify(manifest, null, 2));
}

// ── Public API ──

/**
 * Install a skill for an agent.
 * Creates the skill directory, writes files, and updates the manifest.
 *
 * @param agentId - The agent to install the skill on
 * @param meta - Skill metadata (id will be generated from name if not provided)
 * @param files - Map of relative file paths to content (must include SKILL.md)
 * @returns The skill ID
 */
export async function installSkill(
  agentId: string,
  meta: Omit<SkillMeta, 'id' | 'installedAt' | 'files'> & { id?: string },
  files: Map<string, string>,
): Promise<string> {
  const id = meta.id || nameToId(meta.name);
  const dir = skillDir(agentId, id);

  // Write all files
  const filePaths: string[] = [];
  for (const [path, content] of files) {
    await opfs.writeFile(`${dir}/${path}`, content);
    filePaths.push(path);
  }

  // Build the full SkillMeta
  const skillMeta: SkillMeta = {
    id,
    name: meta.name,
    description: meta.description,
    author: meta.author,
    version: meta.version,
    source: meta.source,
    installedAt: new Date().toISOString(),
    files: filePaths,
  };

  // Update manifest (remove existing entry with same ID, then add)
  const manifest = await readManifest(agentId);
  const filtered = manifest.filter((s) => s.id !== id);
  filtered.push(skillMeta);
  await writeManifest(agentId, filtered);

  return id;
}

/**
 * Remove a skill from an agent.
 * Deletes the skill directory and removes it from the manifest.
 */
export async function removeSkill(agentId: string, skillId: string): Promise<void> {
  // Remove from manifest first
  const manifest = await readManifest(agentId);
  const filtered = manifest.filter((s) => s.id !== skillId);
  await writeManifest(agentId, filtered);

  // Delete the skill directory
  try {
    await opfs.delete(skillDir(agentId, skillId));
  } catch {
    // Directory may not exist, that's OK
  }
}

/**
 * List all installed skills for an agent.
 */
export async function listSkills(agentId: string): Promise<SkillMeta[]> {
  return readManifest(agentId);
}

/**
 * Get the SKILL.md content for a specific skill.
 */
export async function getSkillContent(agentId: string, skillId: string): Promise<string> {
  return opfs.readFile(`${skillDir(agentId, skillId)}/SKILL.md`);
}

/**
 * Get the full skill manifest for an agent.
 * Alias for listSkills, but named to match the plan.
 */
export async function getSkillManifest(agentId: string): Promise<SkillMeta[]> {
  return readManifest(agentId);
}

/**
 * Build the system prompt section for installed skills.
 * Returns empty string if no skills are installed.
 */
export async function buildSkillsPromptSection(agentId: string): Promise<string> {
  const skills = await listSkills(agentId);
  if (skills.length === 0) return '';

  const parts: string[] = ['\n---\n\n## Installed Skills\n'];

  const referenceFiles: string[] = [];

  for (const skill of skills) {
    try {
      const content = await getSkillContent(agentId, skill.id);
      parts.push(`### Skill: ${skill.name}\n`);
      parts.push(content);
      parts.push('');

      // Collect reference files
      for (const file of skill.files) {
        if (file !== 'SKILL.md' && file.endsWith('.md')) {
          referenceFiles.push(`skills/${skill.id}/${file}`);
        }
      }
    } catch {
      // Skip skills with missing SKILL.md
    }
  }

  if (referenceFiles.length > 0) {
    parts.push('---\n');
    parts.push('You also have skill reference files available. Use read_file to access:');
    for (const ref of referenceFiles) {
      parts.push(`- ${ref}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
