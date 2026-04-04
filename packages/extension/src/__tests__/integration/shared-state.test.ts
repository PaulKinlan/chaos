/**
 * Integration Test: Shared State Consistency
 *
 * Tests shared state across agents: concurrent message appends,
 * task event sourcing, artifact publish/read, message filtering,
 * and diamond DAG dependency resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupIntegrationMocks, resetIntegrationState } from './setup.js';

// Install mocks before imports
setupIntegrationMocks();

import { createAgent } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';
import {
  appendMessage,
  getMessages,
  appendTaskEvent,
  getTaskState,
  getUnblockedTasks,
  publishArtifact,
  listArtifacts,
} from '../../storage/shared.js';
import type { AgentMessage, TaskEvent } from '../../storage/types.js';

beforeEach(() => {
  resetIntegrationState();
  (opfs as any).rootPromise = null;
});

describe('Shared State Consistency', () => {
  describe('Multiple agent message appends', () => {
    it('multiple agents append messages sequentially with no data loss', async () => {
      const agentA = await createAgent('AgentA', 'researcher');
      const agentB = await createAgent('AgentB', 'writer');
      const agentC = await createAgent('AgentC', 'coder');

      // Append messages from multiple agents sequentially
      for (let i = 0; i < 10; i++) {
        await appendMessage({
          id: `msg-a-${i}`,
          from: agentA.id,
          to: 'broadcast',
          timestamp: `2026-04-01T10:0${i}:00Z`,
          body: `A message ${i}`,
        });
      }
      for (let i = 0; i < 10; i++) {
        await appendMessage({
          id: `msg-b-${i}`,
          from: agentB.id,
          to: 'broadcast',
          timestamp: `2026-04-01T11:0${i}:00Z`,
          body: `B message ${i}`,
        });
      }

      // All 20 messages should be present
      const allMessages = await getMessages();
      expect(allMessages).toHaveLength(20);

      // Verify no duplicates
      const ids = new Set(allMessages.map(m => m.id));
      expect(ids.size).toBe(20);

      // Verify messages from each agent
      const fromA = allMessages.filter(m => m.from === agentA.id);
      const fromB = allMessages.filter(m => m.from === agentB.id);
      expect(fromA).toHaveLength(10);
      expect(fromB).toHaveLength(10);
    });

    it('interleaved appends from different agents preserve all messages', async () => {
      const agentA = await createAgent('AgentA', 'researcher');
      const agentB = await createAgent('AgentB', 'writer');

      // Interleave messages from A and B
      for (let i = 0; i < 5; i++) {
        await appendMessage({
          id: `msg-a-${i}`,
          from: agentA.id,
          to: 'broadcast',
          timestamp: `2026-04-01T10:${String(i * 2).padStart(2, '0')}:00Z`,
          body: `A message ${i}`,
        });
        await appendMessage({
          id: `msg-b-${i}`,
          from: agentB.id,
          to: 'broadcast',
          timestamp: `2026-04-01T10:${String(i * 2 + 1).padStart(2, '0')}:00Z`,
          body: `B message ${i}`,
        });
      }

      const allMessages = await getMessages();
      expect(allMessages).toHaveLength(10);
      // Messages should be in order they were appended
      expect(allMessages[0].id).toBe('msg-a-0');
      expect(allMessages[1].id).toBe('msg-b-0');
      expect(allMessages[8].id).toBe('msg-a-4');
      expect(allMessages[9].id).toBe('msg-b-4');
    });
  });

  describe('Task event sourcing', () => {
    it('create task, update multiple times, verify computed state', async () => {
      // Create
      await appendTaskEvent({
        taskId: 'task-1',
        type: 'created',
        timestamp: '2026-04-01T10:00:00Z',
        data: {
          subject: 'Build parser',
          description: 'CSV parser module',
          owner: 'agent-a',
          status: 'pending',
        },
      });

      // Update 1: in progress
      await appendTaskEvent({
        taskId: 'task-1',
        type: 'updated',
        timestamp: '2026-04-01T12:00:00Z',
        data: { status: 'in_progress' },
      });

      // Update 2: add result
      await appendTaskEvent({
        taskId: 'task-1',
        type: 'updated',
        timestamp: '2026-04-01T14:00:00Z',
        data: { result: 'Halfway done' },
      });

      // Update 3: completed
      await appendTaskEvent({
        taskId: 'task-1',
        type: 'updated',
        timestamp: '2026-04-01T16:00:00Z',
        data: { status: 'completed', result: 'All done!' },
      });

      const tasks = await getTaskState();
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      expect(task.subject).toBe('Build parser');
      expect(task.description).toBe('CSV parser module');
      expect(task.owner).toBe('agent-a');
      expect(task.status).toBe('completed');
      expect(task.result).toBe('All done!');
      expect(task.createdAt).toBe('2026-04-01T10:00:00Z');
      expect(task.updatedAt).toBe('2026-04-01T16:00:00Z');
    });
  });

  describe('Artifacts', () => {
    it('agent A publishes artifact, agent B can list and read it', async () => {
      const agentA = await createAgent('Publisher', 'researcher');
      const agentB = await createAgent('Consumer', 'writer');

      // A writes a file to shared space and publishes it
      const artifactPath = 'shared/artifacts/report.md';
      await opfs.writeFile(artifactPath, '# Research Report\n\nFindings here.');
      await publishArtifact(agentA.id, artifactPath, 'Weekly research report');

      // B can list artifacts
      const artifacts = await listArtifacts();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].agentId).toBe(agentA.id);
      expect(artifacts[0].path).toBe(artifactPath);
      expect(artifacts[0].description).toBe('Weekly research report');

      // B can read the artifact content
      const content = await opfs.readFile(artifacts[0].path);
      expect(content).toBe('# Research Report\n\nFindings here.');
    });

    it('artifact content matches what was published', async () => {
      const agent = await createAgent('DataAgent', 'coder');

      const originalContent = 'col1,col2,col3\n1,2,3\n4,5,6';
      const artifactPath = 'shared/artifacts/data.csv';
      await opfs.writeFile(artifactPath, originalContent);
      await publishArtifact(agent.id, artifactPath, 'Raw data export');

      // Read back through artifact listing
      const artifacts = await listArtifacts();
      const readContent = await opfs.readFile(artifacts[0].path);
      expect(readContent).toBe(originalContent);
    });

    it('artifacts can be filtered by agent', async () => {
      const agentA = await createAgent('AgentA', 'researcher');
      const agentB = await createAgent('AgentB', 'writer');

      await opfs.writeFile('shared/artifacts/a1.md', 'from A');
      await publishArtifact(agentA.id, 'shared/artifacts/a1.md', 'A artifact 1');

      await opfs.writeFile('shared/artifacts/b1.md', 'from B');
      await publishArtifact(agentB.id, 'shared/artifacts/b1.md', 'B artifact 1');

      await opfs.writeFile('shared/artifacts/a2.md', 'from A again');
      await publishArtifact(agentA.id, 'shared/artifacts/a2.md', 'A artifact 2');

      const aArtifacts = await listArtifacts({ agentId: agentA.id });
      expect(aArtifacts).toHaveLength(2);
      expect(aArtifacts.every(a => a.agentId === agentA.id)).toBe(true);

      const bArtifacts = await listArtifacts({ agentId: agentB.id });
      expect(bArtifacts).toHaveLength(1);
    });
  });

  describe('Message filtering', () => {
    it('getMessages correctly filters by agent, since, and limit in combination', async () => {
      const msgs: AgentMessage[] = [
        { id: 'm1', from: 'agent-x', to: 'broadcast', timestamp: '2026-04-01T08:00:00Z', body: 'x morning' },
        { id: 'm2', from: 'agent-y', to: 'broadcast', timestamp: '2026-04-01T09:00:00Z', body: 'y morning' },
        { id: 'm3', from: 'agent-x', to: 'broadcast', timestamp: '2026-04-01T14:00:00Z', body: 'x afternoon 1' },
        { id: 'm4', from: 'agent-x', to: 'broadcast', timestamp: '2026-04-01T15:00:00Z', body: 'x afternoon 2' },
        { id: 'm5', from: 'agent-x', to: 'broadcast', timestamp: '2026-04-01T18:00:00Z', body: 'x evening' },
        { id: 'm6', from: 'agent-y', to: 'broadcast', timestamp: '2026-04-01T20:00:00Z', body: 'y evening' },
      ];

      for (const msg of msgs) await appendMessage(msg);

      // Agent x, since noon, limit 2
      const filtered = await getMessages({
        agentId: 'agent-x',
        since: '2026-04-01T12:00:00Z',
        limit: 2,
      });
      // x has 3 messages after noon (m3, m4, m5), limit 2 from tail = m4, m5
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('m4');
      expect(filtered[1].id).toBe('m5');
    });
  });

  describe('Task dependency resolution: diamond DAG', () => {
    it('A→B, A→C, B+C→D: correct unblocking order', async () => {
      // Create diamond: A -> B, A -> C, B+C -> D
      await appendTaskEvent({
        taskId: 'A', type: 'created',
        timestamp: '2026-04-01T10:00:00Z',
        data: { subject: 'Task A', status: 'pending' },
      });
      await appendTaskEvent({
        taskId: 'B', type: 'created',
        timestamp: '2026-04-01T10:01:00Z',
        data: { subject: 'Task B', status: 'pending', blockedBy: ['A'] },
      });
      await appendTaskEvent({
        taskId: 'C', type: 'created',
        timestamp: '2026-04-01T10:02:00Z',
        data: { subject: 'Task C', status: 'pending', blockedBy: ['A'] },
      });
      await appendTaskEvent({
        taskId: 'D', type: 'created',
        timestamp: '2026-04-01T10:03:00Z',
        data: { subject: 'Task D', status: 'pending', blockedBy: ['B', 'C'] },
      });

      // Only A is unblocked initially
      let unblocked = await getUnblockedTasks();
      expect(unblocked.map(t => t.id)).toEqual(['A']);

      // Complete A → B and C unblocked
      await appendTaskEvent({
        taskId: 'A', type: 'updated',
        timestamp: '2026-04-01T11:00:00Z',
        data: { status: 'completed' },
      });
      unblocked = await getUnblockedTasks();
      expect(unblocked.map(t => t.id).sort()).toEqual(['B', 'C']);

      // Complete B → C still unblocked, D still blocked (C not done)
      await appendTaskEvent({
        taskId: 'B', type: 'updated',
        timestamp: '2026-04-01T12:00:00Z',
        data: { status: 'completed' },
      });
      unblocked = await getUnblockedTasks();
      expect(unblocked.map(t => t.id)).toEqual(['C']);

      // Complete C → D unblocked
      await appendTaskEvent({
        taskId: 'C', type: 'updated',
        timestamp: '2026-04-01T13:00:00Z',
        data: { status: 'completed' },
      });
      unblocked = await getUnblockedTasks();
      expect(unblocked.map(t => t.id)).toEqual(['D']);
    });
  });
});
