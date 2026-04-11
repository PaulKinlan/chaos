import { describe, it, expect, vi } from 'vitest';
import { createOrchestrator } from '../src/orchestrator.js';
import { createMockModel } from '../src/testing/index.js';
import type { AgentConfig } from '../src/types.js';

// Helper to cast mock model
function mockModel(
  ...args: Parameters<typeof createMockModel>
): AgentConfig['model'] {
  return createMockModel(...args) as unknown as AgentConfig['model'];
}

function workerConfig(id: string, name: string, responseText: string): AgentConfig {
  return {
    id,
    name,
    model: mockModel({ responses: [{ text: responseText }] }),
    maxIterations: 3,
  };
}

describe('createOrchestrator', () => {
  it('creates an orchestrator with master + 2 workers', () => {
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master Agent',
        model: mockModel({ responses: [{ text: 'Done.' }] }),
        maxIterations: 5,
      },
      workers: [
        workerConfig('researcher', 'Researcher', 'Research complete.'),
        workerConfig('writer', 'Writer', 'Article written.'),
      ],
    });

    expect(orchestrator.master).toBeDefined();
    expect(orchestrator.master.id).toBe('master');
    expect(orchestrator.master.name).toBe('Master Agent');
    expect(orchestrator.workers.size).toBe(2);
    expect(orchestrator.workers.has('researcher')).toBe(true);
    expect(orchestrator.workers.has('writer')).toBe(true);
  });

  it('master can delegate a task to a worker', async () => {
    // Master calls delegate_task to the researcher, then responds with text
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({
          responses: [
            {
              toolCalls: [
                {
                  toolName: 'delegate_task',
                  args: { agentId: 'researcher', task: 'Find info about AI' },
                },
              ],
            },
            { text: 'The researcher found: AI is cool.' },
          ],
        }),
        maxIterations: 5,
      },
      workers: [
        workerConfig('researcher', 'Researcher', 'AI is evolving rapidly.'),
      ],
    });

    const result = await orchestrator.run('Research AI trends');
    expect(result).toBe('The researcher found: AI is cool.');
  });

  it('master can list available agents via list_agents tool', async () => {
    // Master calls list_agents, then responds with text
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({
          responses: [
            {
              toolCalls: [
                { toolName: 'list_agents', args: {} },
              ],
            },
            { text: 'I have 2 workers available.' },
          ],
        }),
        maxIterations: 5,
      },
      workers: [
        workerConfig('researcher', 'Researcher', 'done'),
        workerConfig('writer', 'Writer', 'done'),
      ],
    });

    const result = await orchestrator.run('What agents do I have?');
    expect(result).toBe('I have 2 workers available.');
  });

  it('worker returns result back to master via messaging', async () => {
    const messageSend = vi.fn();
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({
          responses: [
            {
              toolCalls: [
                {
                  toolName: 'delegate_task',
                  args: { agentId: 'worker1', task: 'Summarize data' },
                },
              ],
            },
            { text: 'Summary received.' },
          ],
        }),
        maxIterations: 5,
      },
      workers: [
        workerConfig('worker1', 'Worker One', 'Data summary: all good.'),
      ],
      messaging: {
        send: messageSend,
        receive: async () => null,
      },
    });

    const result = await orchestrator.run('Get a summary');
    expect(result).toBe('Summary received.');

    // Verify messages were sent: task to worker, result back to master
    expect(messageSend).toHaveBeenCalledWith('master', 'worker1', 'Summarize data');
    expect(messageSend).toHaveBeenCalledWith('worker1', 'master', 'Data summary: all good.');
  });

  it('addWorker adds a new worker and removeWorker removes it', () => {
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({ responses: [{ text: 'ok' }] }),
        maxIterations: 3,
      },
      workers: [],
    });

    expect(orchestrator.workers.size).toBe(0);

    const newWorker = orchestrator.addWorker(
      workerConfig('analyst', 'Analyst', 'Analysis done.'),
    );
    expect(orchestrator.workers.size).toBe(1);
    expect(newWorker.id).toBe('analyst');

    orchestrator.removeWorker('analyst');
    expect(orchestrator.workers.size).toBe(0);
  });

  it('delegating to a non-existent worker returns an error string', async () => {
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({
          responses: [
            {
              toolCalls: [
                {
                  toolName: 'delegate_task',
                  args: { agentId: 'nonexistent', task: 'Do stuff' },
                },
              ],
            },
            { text: 'Could not delegate.' },
          ],
        }),
        maxIterations: 5,
      },
      workers: [],
    });

    const result = await orchestrator.run('Delegate something');
    expect(result).toBe('Could not delegate.');
  });

  it('stream yields progress events from master', async () => {
    const orchestrator = createOrchestrator({
      master: {
        id: 'master',
        name: 'Master',
        model: mockModel({ responses: [{ text: 'streamed result' }] }),
        maxIterations: 3,
      },
      workers: [],
    });

    const eventTypes: string[] = [];
    for await (const event of orchestrator.stream('stream test')) {
      eventTypes.push(event.type);
    }
    expect(eventTypes).toContain('done');
  });
});
