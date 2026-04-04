/**
 * Agent Manager
 *
 * Handles agent lifecycle: creation, listing, retrieval, deletion,
 * and metadata updates. Uses OPFS for agent file storage and
 * Chrome storage for metadata.
 */

import { opfs } from '../storage/opfs.js';
import { getAgentList, setAgentList } from '../storage/chrome-storage.js';
import { getTemplate } from './templates/index.js';
import type { AgentMeta } from '../storage/types.js';

/** Base path for all agent storage in OPFS. */
const AGENTS_ROOT = 'agents';

/** Subdirectories created for each new agent. */
const AGENT_DIRS = [
  'memories',
  'people',
  'ideas',
  'bookmarks',
  'conversations',
];

/** Generate a unique agent ID. */
function generateId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new agent with the given name and role.
 *
 * Sets up the OPFS directory structure, writes the initial CLAUDE.md
 * from the role template, creates a Chrome bookmark folder, and
 * registers the agent in Chrome storage.
 */
export async function createAgent(
  name: string,
  role: string,
): Promise<AgentMeta> {
  const id = generateId();
  const agentRoot = `${AGENTS_ROOT}/${id}`;

  // Create directory structure
  await opfs.mkdir(agentRoot);
  for (const dir of AGENT_DIRS) {
    await opfs.mkdir(`${agentRoot}/${dir}`);
  }

  // Write initial CLAUDE.md from template
  const templateFn = getTemplate(role);
  const claudeMd = templateFn(name);
  await opfs.writeFile(`${agentRoot}/CLAUDE.md`, claudeMd);

  // Write initial empty TODO.md
  await opfs.writeFile(`${agentRoot}/TODO.md`, `# ${name} - Tasks\n\n`);

  // Create Chrome bookmark folder
  let bookmarkFolderId: string | undefined;
  try {
    const folder = await chrome.bookmarks.create({ title: `CHAOS: ${name}` });
    bookmarkFolderId = folder.id;
  } catch {
    // Bookmark API may not be available in tests or some contexts
  }

  // Build metadata
  const meta: AgentMeta = {
    id,
    name,
    role,
    visibility: 'private',
    bookmarkFolderId,
    createdAt: new Date().toISOString(),
  };

  // Register in Chrome storage
  const agents = await getAgentList();
  agents.push(meta);
  await setAgentList(agents);

  return meta;
}

/**
 * List all registered agents.
 */
export async function listAgents(): Promise<AgentMeta[]> {
  return getAgentList();
}

/**
 * Get an agent's metadata and CLAUDE.md content.
 */
export async function getAgent(
  id: string,
): Promise<{ meta: AgentMeta; claudeMd: string }> {
  const agents = await getAgentList();
  const meta = agents.find((a) => a.id === id);
  if (!meta) {
    throw new Error(`Agent not found: ${id}`);
  }

  const claudeMd = await opfs.readFile(`${AGENTS_ROOT}/${id}/CLAUDE.md`);
  return { meta, claudeMd };
}

/**
 * Delete an agent: removes OPFS directory, Chrome storage entry,
 * and bookmark folder.
 */
export async function deleteAgent(id: string): Promise<void> {
  // Remove OPFS directory
  try {
    await opfs.delete(`${AGENTS_ROOT}/${id}`);
  } catch {
    // Directory may already be gone
  }

  // Remove from Chrome storage
  const agents = await getAgentList();
  const updated = agents.filter((a) => a.id !== id);

  // Find the agent to clean up its bookmark folder
  const agent = agents.find((a) => a.id === id);
  if (agent?.bookmarkFolderId) {
    try {
      await chrome.bookmarks.removeTree(agent.bookmarkFolderId);
    } catch {
      // Bookmark folder may already be gone
    }
  }

  await setAgentList(updated);
}

/**
 * Update an agent's metadata (partial update).
 */
export async function updateAgentMeta(
  id: string,
  updates: Partial<AgentMeta>,
): Promise<void> {
  const agents = await getAgentList();
  const index = agents.findIndex((a) => a.id === id);
  if (index === -1) {
    throw new Error(`Agent not found: ${id}`);
  }

  // Don't allow changing the ID
  const { id: _id, ...safeUpdates } = updates;
  agents[index] = { ...agents[index], ...safeUpdates };
  await setAgentList(agents);
}

/**
 * Archive an agent: removes from active agent list but keeps OPFS data.
 * Stores archive metadata (name, role, archived date) in OPFS so it
 * can be discovered later.
 */
export async function archiveAgent(id: string): Promise<void> {
  const agents = await getAgentList();
  const agent = agents.find((a) => a.id === id);
  if (!agent) {
    throw new Error(`Agent not found: ${id}`);
  }

  // Write archive metadata to the agent's OPFS directory
  const archiveMeta = {
    ...agent,
    archivedAt: new Date().toISOString(),
  };
  await opfs.writeFile(
    `${AGENTS_ROOT}/${id}/archive-meta.json`,
    JSON.stringify(archiveMeta, null, 2),
  );

  // Remove bookmark folder
  if (agent.bookmarkFolderId) {
    try {
      await chrome.bookmarks.removeTree(agent.bookmarkFolderId);
    } catch {
      // Bookmark folder may already be gone
    }
  }

  // Remove from active list
  const updated = agents.filter((a) => a.id !== id);
  await setAgentList(updated);
}

/**
 * List archived agents by scanning OPFS for agent directories
 * that have archive-meta.json but are not in the active agent list.
 */
export async function listArchivedAgents(): Promise<(AgentMeta & { archivedAt?: string })[]> {
  const activeAgents = await getAgentList();
  const activeIds = new Set(activeAgents.map((a) => a.id));

  const archived: (AgentMeta & { archivedAt?: string })[] = [];

  try {
    const entries = await opfs.listDir(AGENTS_ROOT);
    for (const name of entries) {
      if (activeIds.has(name)) continue; // Skip active agents

      try {
        const raw = await opfs.readFile(`${AGENTS_ROOT}/${name}/archive-meta.json`);
        const meta = JSON.parse(raw) as AgentMeta & { archivedAt?: string };
        archived.push(meta);
      } catch {
        // No archive-meta.json or invalid JSON, skip
      }
    }
  } catch {
    // OPFS listing failed, return empty
  }

  return archived;
}

/**
 * Restore an archived agent back to the active agent list.
 * Reads the archive-meta.json from OPFS and re-adds the agent.
 */
export async function restoreAgent(id: string): Promise<AgentMeta | null> {
  try {
    const raw = await opfs.readFile(`${AGENTS_ROOT}/${id}/archive-meta.json`);
    const archiveMeta = JSON.parse(raw) as AgentMeta & { archivedAt?: string };

    // Remove the archivedAt field and rebuild clean AgentMeta
    const { archivedAt: _archived, ...meta } = archiveMeta;

    // Clear the bookmark folder ID since it was removed on archive
    meta.bookmarkFolderId = undefined;

    // Try to create a new bookmark folder
    try {
      const folder = await chrome.bookmarks.create({ title: `CHAOS: ${meta.name}` });
      meta.bookmarkFolderId = folder.id;
    } catch {
      // Bookmark API may not be available
    }

    // Add back to active list
    const agents = await getAgentList();
    // Make sure it's not already in the list
    const filtered = agents.filter((a) => a.id !== id);
    filtered.push(meta);
    await setAgentList(filtered);

    // Clean up archive metadata file
    try {
      await opfs.delete(`${AGENTS_ROOT}/${id}/archive-meta.json`);
    } catch {
      // Non-fatal
    }

    return meta;
  } catch {
    return null;
  }
}
