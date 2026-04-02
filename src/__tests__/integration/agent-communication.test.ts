/**
 * Integration Test: Agent Communication
 *
 * Tests multi-agent communication end-to-end: messages, broadcasts,
 * agent discovery, task creation, task dependencies, and privacy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupIntegrationMocks, resetIntegrationState } from './setup.js';

// Install mocks before imports
setupIntegrationMocks();

import { createAgent, updateAgentMeta } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';
import {
  appendMessage,
  getMessages,
  appendTaskEvent,
  getTaskState,
  getUnblockedTasks,
} from '../../storage/shared.js';
import { getAgentList } from '../../storage/chrome-storage.js';
import type { AgentMessage, TaskEvent } from '../../storage/types.js';

beforeEach(() => {
  resetIntegrationState();
  (opfs as any).rootPromise = null;
});

describe('Agent Communication', () => {
  it('agent A sends a message to agent B and B sees it', async () => {
    const agentA = await createAgent('Researcher', 'researcher');
    const agentB = await createAgent('Writer', 'writer');
    await updateAgentMeta(agentA.id, { visibility: 'visible' });
    await updateAgentMeta(agentB.id, { visibility: 'visible' });

    const msg: AgentMessage = {
      id: 'msg-1',
      from: agentA.id,
      to: agentB.id,
      timestamp: new Date().toISOString(),
      body: 'Here are the research results',
    };
    await appendMessage(msg);

    // B should see the message when filtering for messages to B
    const allMessages = await getMessages();
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].from).toBe(agentA.id);
    expect(allMessages[0].to).toBe(agentB.id);
    expect(allMessages[0].body).toBe('Here are the research results');
  });

  it('agent A broadcasts a message and all agents see it', async () => {
    const agentA = await createAgent('Announcer', 'researcher');
    const agentB = await createAgent('Listener1', 'writer');
    const agentC = await createAgent('Listener2', 'coder');
    await updateAgentMeta(agentA.id, { visibility: 'visible' });
    await updateAgentMeta(agentB.id, { visibility: 'visible' });
    await updateAgentMeta(agentC.id, { visibility: 'visible' });

    const msg: AgentMessage = {
      id: 'msg-broadcast',
      from: agentA.id,
      to: 'broadcast',
      timestamp: new Date().toISOString(),
      body: 'Important announcement',
    };
    await appendMessage(msg);

    const allMessages = await getMessages();
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].to).toBe('broadcast');
    expect(allMessages[0].body).toBe('Important announcement');
  });

  it('private agent can still send messages (sender privacy does not block outgoing)', async () => {
    const privateAgent = await createAgent('SecretAgent', 'researcher');
    const publicAgent = await createAgent('PublicAgent', 'writer');
    await updateAgentMeta(publicAgent.id, { visibility: 'visible' });
    // privateAgent stays private (default)

    const msg: AgentMessage = {
      id: 'msg-from-private',
      from: privateAgent.id,
      to: publicAgent.id,
      timestamp: new Date().toISOString(),
      body: 'Secret tip',
    };
    await appendMessage(msg);

    const messages = await getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe(privateAgent.id);
    expect(messages[0].body).toBe('Secret tip');
  });

  it('private agent does not appear in agent discovery', async () => {
    const privateAgent = await createAgent('Hidden', 'researcher');
    const visibleAgent = await createAgent('Visible', 'writer');
    await updateAgentMeta(visibleAgent.id, { visibility: 'visible' });
    // privateAgent stays private

    const agents = await getAgentList();
    const discoverable = agents.filter(
      a => a.visibility !== 'private',
    );

    expect(discoverable).toHaveLength(1);
    expect(discoverable[0].id).toBe(visibleAgent.id);
    expect(discoverable.find(a => a.id === privateAgent.id)).toBeUndefined();
  });

  it('agent A creates a task assigned to B, B sees it, B completes it, A sees completion', async () => {
    const agentA = await createAgent('TaskCreator', 'planner');
    const agentB = await createAgent('TaskWorker', 'coder');
    await updateAgentMeta(agentA.id, { visibility: 'visible' });
    await updateAgentMeta(agentB.id, { visibility: 'visible' });

    // A creates task for B
    const createEvent: TaskEvent = {
      taskId: 'task-1',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: {
        subject: 'Write the parser',
        description: 'Implement the CSV parser module',
        owner: agentB.id,
        status: 'pending',
      },
    };
    await appendTaskEvent(createEvent);

    // B can see the task
    let tasks = await getTaskState();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].owner).toBe(agentB.id);
    expect(tasks[0].status).toBe('pending');

    // B completes the task
    await appendTaskEvent({
      taskId: 'task-1',
      type: 'updated',
      timestamp: '2026-04-01T14:00:00Z',
      data: { status: 'completed', result: 'Parser implemented and tested' },
    });

    // A can see the completion
    tasks = await getTaskState();
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].result).toBe('Parser implemented and tested');
  });

  it('task dependencies: chain A→B→C, only A unblocked initially', async () => {
    await appendTaskEvent({
      taskId: 'task-A',
      type: 'created',
      timestamp: '2026-04-01T10:00:00Z',
      data: { subject: 'Step A', status: 'pending' },
    });
    await appendTaskEvent({
      taskId: 'task-B',
      type: 'created',
      timestamp: '2026-04-01T10:01:00Z',
      data: { subject: 'Step B', status: 'pending', blockedBy: ['task-A'] },
    });
    await appendTaskEvent({
      taskId: 'task-C',
      type: 'created',
      timestamp: '2026-04-01T10:02:00Z',
      data: { subject: 'Step C', status: 'pending', blockedBy: ['task-B'] },
    });

    // Only A is unblocked
    let unblocked = await getUnblockedTasks();
    expect(unblocked.map(t => t.id)).toEqual(['task-A']);

    // Complete A → B unblocked
    await appendTaskEvent({
      taskId: 'task-A',
      type: 'updated',
      timestamp: '2026-04-01T11:00:00Z',
      data: { status: 'completed' },
    });
    unblocked = await getUnblockedTasks();
    expect(unblocked.map(t => t.id)).toEqual(['task-B']);

    // Complete B → C unblocked
    await appendTaskEvent({
      taskId: 'task-B',
      type: 'updated',
      timestamp: '2026-04-01T12:00:00Z',
      data: { status: 'completed' },
    });
    unblocked = await getUnblockedTasks();
    expect(unblocked.map(t => t.id)).toEqual(['task-C']);
  });

  it('message filtering by agent, since, and limit in combination', async () => {
    const agentA = await createAgent('SenderA', 'researcher');
    const agentB = await createAgent('SenderB', 'writer');

    const messages: AgentMessage[] = [
      { id: 'm1', from: agentA.id, to: 'broadcast', timestamp: '2026-04-01T08:00:00Z', body: 'A morning' },
      { id: 'm2', from: agentB.id, to: 'broadcast', timestamp: '2026-04-01T09:00:00Z', body: 'B morning' },
      { id: 'm3', from: agentA.id, to: 'broadcast', timestamp: '2026-04-01T14:00:00Z', body: 'A afternoon' },
      { id: 'm4', from: agentA.id, to: 'broadcast', timestamp: '2026-04-01T18:00:00Z', body: 'A evening' },
      { id: 'm5', from: agentB.id, to: 'broadcast', timestamp: '2026-04-01T20:00:00Z', body: 'B evening' },
    ];
    for (const msg of messages) await appendMessage(msg);

    // Filter by agent A + since noon + limit 1
    const filtered = await getMessages({
      agentId: agentA.id,
      since: '2026-04-01T12:00:00Z',
      limit: 1,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('m4'); // last of A's afternoon/evening messages
  });
});
