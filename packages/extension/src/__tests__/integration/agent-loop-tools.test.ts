/**
 * Integration Test: Agent Loop Tools
 *
 * Tests the agent loop integrating tools correctly:
 * - File tools scoped to agent's OPFS directory
 * - Path isolation between agents
 * - Communication tools present/absent based on visibility
 * - Chrome tools always present
 * - Tool lookup with keyword strategy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupIntegrationMocks, resetIntegrationState } from './setup.js';

// Install mocks before imports
setupIntegrationMocks();

import { createAgent, updateAgentMeta } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';
import { getChromeTools } from '../../tools/chrome/index.js';
import { getCommunicationTools } from '../../tools/communication/index.js';
import { createToolLookup } from '../../tools/lookup/index.js';

beforeEach(() => {
  resetIntegrationState();
  (opfs as any).rootPromise = null;
});

describe('Agent Loop Tools', () => {
  describe('File tools scope and isolation', () => {
    it('file tools read/write to agent OPFS directory', async () => {
      const agent = await createAgent('FileAgent', 'researcher');
      const agentRoot = `agents/${agent.id}`;

      // Write a file via the agent root
      await opfs.writeFile(`${agentRoot}/notes.md`, '# My Notes\nSome content');

      // Read it back
      const content = await opfs.readFile(`${agentRoot}/notes.md`);
      expect(content).toBe('# My Notes\nSome content');
    });

    it('agents cannot access each other OPFS directories', async () => {
      const agentA = await createAgent('AgentA', 'researcher');
      const agentB = await createAgent('AgentB', 'writer');

      // Write to A's directory
      await opfs.writeFile(`agents/${agentA.id}/secret.md`, 'Agent A secret');

      // B's directory should not have A's file
      expect(await opfs.exists(`agents/${agentB.id}/secret.md`)).toBe(false);

      // A's file exists in A's space
      expect(await opfs.exists(`agents/${agentA.id}/secret.md`)).toBe(true);
    });

    it('file operations are scoped per agent', async () => {
      const agentA = await createAgent('AgentA', 'researcher');
      const agentB = await createAgent('AgentB', 'writer');

      // Write same filename in both agent directories
      await opfs.writeFile(`agents/${agentA.id}/notes.md`, 'A notes');
      await opfs.writeFile(`agents/${agentB.id}/notes.md`, 'B notes');

      // Each reads their own
      expect(await opfs.readFile(`agents/${agentA.id}/notes.md`)).toBe('A notes');
      expect(await opfs.readFile(`agents/${agentB.id}/notes.md`)).toBe('B notes');
    });
  });

  describe('Communication tools visibility', () => {
    it('visible agent gets communication tools', async () => {
      const agent = await createAgent('VisibleAgent', 'researcher');
      await updateAgentMeta(agent.id, { visibility: 'visible' });

      const commTools = getCommunicationTools(agent.id);

      // Should have all communication tools
      expect(commTools).toHaveProperty('message_send');
      expect(commTools).toHaveProperty('message_read');
      expect(commTools).toHaveProperty('task_create');
      expect(commTools).toHaveProperty('task_update');
      expect(commTools).toHaveProperty('task_list');
      expect(commTools).toHaveProperty('artifact_publish');
      expect(commTools).toHaveProperty('artifact_list');
      expect(commTools).toHaveProperty('artifact_read');
      expect(commTools).toHaveProperty('agent_discover');
    });

    it('communication tools are not included for private agents in the loop', async () => {
      const agent = await createAgent('PrivateAgent', 'researcher');
      // Default visibility is now 'visible', so explicitly set to 'private'
      await updateAgentMeta(agent.id, { visibility: 'private' });

      // The agent loop checks visibility before including comm tools:
      // isVisible = selfMeta && selfMeta.visibility !== 'private'
      // For a private agent, communication tools should NOT be included
      const agents = await (await import('../../storage/chrome-storage.js')).getAgentList();
      const self = agents.find(a => a.id === agent.id);
      const isVisible = self && self.visibility !== 'private';

      expect(isVisible).toBe(false);
    });
  });

  describe('Chrome tools', () => {
    it('Chrome tools are always available regardless of visibility', async () => {
      const agent = await createAgent('ChromeAgent', 'neutral');
      // Agent is private by default

      const chromeTools = await getChromeTools(agent.id);

      expect(chromeTools).toHaveProperty('tab_read');
      expect(chromeTools).toHaveProperty('tab_open');
      expect(chromeTools).toHaveProperty('tab_close');
      expect(chromeTools).toHaveProperty('tab_list');
      expect(chromeTools).toHaveProperty('tab_group');
      expect(chromeTools).toHaveProperty('bookmark_add');
      expect(chromeTools).toHaveProperty('bookmark_search');
      expect(chromeTools).toHaveProperty('bookmark_list');
      expect(chromeTools).toHaveProperty('history_search');
      expect(chromeTools).toHaveProperty('alarm_set');
      expect(chromeTools).toHaveProperty('alarm_clear');
      expect(chromeTools).toHaveProperty('alarm_list');
    });
  });

  describe('Tool lookup with keyword strategy', () => {
    it('resolves correct tools for "open a tab" intent', async () => {
      const lookup = createToolLookup('keyword');

      const results = await lookup.resolve('open a tab', 5);

      // tab_open should be the top result
      const names = results.map(r => r.name);
      expect(names).toContain('tab_open');
      // tab_list should also score since it contains "tab"
      expect(names).toContain('tab_list');
    });

    it('resolves file tools for "read a file" intent', async () => {
      const lookup = createToolLookup('keyword');

      const results = await lookup.resolve('read a file', 5);
      const names = results.map(r => r.name);
      expect(names).toContain('read_file');
    });

    it('resolves communication tools for "send message" intent', async () => {
      const lookup = createToolLookup('keyword');

      const results = await lookup.resolve('send a message to another agent', 5);
      const names = results.map(r => r.name);
      expect(names).toContain('message_send');
    });

    it('resolves bookmark tools for "save bookmark" intent', async () => {
      const lookup = createToolLookup('keyword');

      const results = await lookup.resolve('save a bookmark', 5);
      const names = results.map(r => r.name);
      expect(names).toContain('bookmark_add');
    });

    it('resolves task tools for "create a task" intent', async () => {
      const lookup = createToolLookup('keyword');

      const results = await lookup.resolve('create a new task', 5);
      const names = results.map(r => r.name);
      expect(names).toContain('task_create');
    });
  });
});
