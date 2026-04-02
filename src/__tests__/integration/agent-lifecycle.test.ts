/**
 * Integration Test: Agent Lifecycle
 *
 * Tests the full agent lifecycle from creation through deletion,
 * verifying OPFS directory structure, Chrome storage, and isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupIntegrationMocks, resetIntegrationState } from './setup.js';

// Install mocks before any imports that use them
setupIntegrationMocks();

import { createAgent, listAgents, getAgent, deleteAgent, updateAgentMeta } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';
import { getAgentList } from '../../storage/chrome-storage.js';

beforeEach(() => {
  resetIntegrationState();
  // Re-create OPFS singleton to pick up new root
  // The opfs module uses navigator.storage.getDirectory which we've re-stubbed
  (opfs as any).rootPromise = null;
});

describe('Agent Lifecycle', () => {
  it('creates an agent with correct OPFS directory structure', async () => {
    const agent = await createAgent('Alice', 'researcher');

    // Verify all expected subdirectories exist
    const expectedDirs = ['memories', 'people', 'ideas', 'bookmarks', 'conversations'];
    for (const dir of expectedDirs) {
      const dirPath = `agents/${agent.id}/${dir}`;
      expect(await opfs.exists(dirPath)).toBe(true);
    }
  });

  it('writes CLAUDE.md from the correct role template', async () => {
    const agent = await createAgent('ResearchBot', 'researcher');
    const claudeMd = await opfs.readFile(`agents/${agent.id}/CLAUDE.md`);

    // The researcher template should include the agent name
    expect(claudeMd).toContain('ResearchBot');
  });

  it('writes initial TODO.md', async () => {
    const agent = await createAgent('Alice', 'researcher');
    const todoMd = await opfs.readFile(`agents/${agent.id}/TODO.md`);
    expect(todoMd).toContain('Alice');
    expect(todoMd).toContain('Tasks');
  });

  it('agent appears in chrome storage agent list', async () => {
    const agent = await createAgent('Bob', 'writer');
    const agents = await getAgentList();

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe(agent.id);
    expect(agents[0].name).toBe('Bob');
    expect(agents[0].role).toBe('writer');
    expect(agents[0].visibility).toBe('private');
  });

  it('update agent visibility persists', async () => {
    const agent = await createAgent('Charlie', 'coder');
    await updateAgentMeta(agent.id, { visibility: 'visible' });

    const agents = await getAgentList();
    const updated = agents.find(a => a.id === agent.id);
    expect(updated?.visibility).toBe('visible');
  });

  it('getAgent returns meta and CLAUDE.md', async () => {
    const created = await createAgent('Diana', 'planner');
    const { meta, claudeMd } = await getAgent(created.id);

    expect(meta.name).toBe('Diana');
    expect(meta.role).toBe('planner');
    expect(claudeMd).toContain('Diana');
  });

  it('delete agent removes OPFS directory and chrome storage entry', async () => {
    const agent = await createAgent('Eve', 'reviewer');

    // Verify exists before deletion
    expect(await opfs.exists(`agents/${agent.id}`)).toBe(true);
    let agents = await getAgentList();
    expect(agents).toHaveLength(1);

    // Delete
    await deleteAgent(agent.id);

    // OPFS directory should be gone
    expect(await opfs.exists(`agents/${agent.id}`)).toBe(false);

    // Chrome storage should be empty
    agents = await getAgentList();
    expect(agents).toHaveLength(0);
  });

  it('create multiple agents with different roles and verify isolation', async () => {
    const researcher = await createAgent('Researcher', 'researcher');
    const writer = await createAgent('Writer', 'writer');
    const coder = await createAgent('Coder', 'coder');

    // All three should be in the agent list
    const agents = await listAgents();
    expect(agents).toHaveLength(3);

    // Each should have its own CLAUDE.md with different content
    const rMd = await opfs.readFile(`agents/${researcher.id}/CLAUDE.md`);
    const wMd = await opfs.readFile(`agents/${writer.id}/CLAUDE.md`);
    const cMd = await opfs.readFile(`agents/${coder.id}/CLAUDE.md`);

    expect(rMd).toContain('Researcher');
    expect(wMd).toContain('Writer');
    expect(cMd).toContain('Coder');

    // Each should have independent directory structures
    expect(await opfs.exists(`agents/${researcher.id}/memories`)).toBe(true);
    expect(await opfs.exists(`agents/${writer.id}/memories`)).toBe(true);
    expect(await opfs.exists(`agents/${coder.id}/memories`)).toBe(true);

    // Deleting one should not affect the others
    await deleteAgent(writer.id);
    const remaining = await listAgents();
    expect(remaining).toHaveLength(2);
    expect(remaining.find(a => a.id === writer.id)).toBeUndefined();
    expect(remaining.find(a => a.id === researcher.id)).toBeDefined();
    expect(remaining.find(a => a.id === coder.id)).toBeDefined();
  });

  it('agent has a bookmark folder created', async () => {
    const agent = await createAgent('BookmarkTest', 'neutral');
    expect(agent.bookmarkFolderId).toBeDefined();
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      title: 'CHAOS: BookmarkTest',
    });
  });

  it('delete agent removes bookmark folder', async () => {
    const agent = await createAgent('RemoveMe', 'neutral');
    const folderId = agent.bookmarkFolderId;

    await deleteAgent(agent.id);

    expect(chrome.bookmarks.removeTree).toHaveBeenCalledWith(folderId);
  });

  it('updateAgentMeta does not allow changing the ID', async () => {
    const agent = await createAgent('Stable', 'neutral');
    await updateAgentMeta(agent.id, { id: 'hacked-id' } as any);

    const agents = await getAgentList();
    expect(agents[0].id).toBe(agent.id);
    expect(agents[0].id).not.toBe('hacked-id');
  });

  it('updateAgentMeta throws for nonexistent agent', async () => {
    await expect(
      updateAgentMeta('nonexistent', { visibility: 'visible' }),
    ).rejects.toThrow('Agent not found');
  });

  it('getAgent throws for nonexistent agent', async () => {
    await expect(getAgent('nonexistent')).rejects.toThrow('Agent not found');
  });
});
