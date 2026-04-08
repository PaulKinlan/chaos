import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChaosSDK } from '../../src/sdk.js';
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '../../src/stores/in-memory.js';
import type { ProgressUpdate } from '../../src/types.js';

function mockModel(...args: Parameters<typeof createMockModel>) {
  return createMockModel(...args) as any;
}

describe('SDK + agent-loop integration', () => {
  let sdk: ChaosSDK;
  let memoryStore: InMemoryMemoryStore;

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();

    // Create agents with their own configs — each is independent
    const assistant = createAgent({
      id: 'assistant',
      name: 'Assistant',
      model: mockModel({ responses: [{ text: 'Hello from Assistant.' }] }),
      maxIterations: 3,
    });

    const researcher = createAgent({
      id: 'researcher',
      name: 'Researcher',
      model: mockModel({ responses: [{ text: 'Research results here.' }] }),
      maxIterations: 5,
    });

    sdk = new ChaosSDK({
      settings: new InMemorySettingsStore(),
      memory: memoryStore,
      conversations: new InMemoryConversationStore(),
      hooks: new InMemoryHookStore(),
      usage: new InMemoryUsageStore(),
      agentStore: new InMemoryAgentStore(),
      agents: [assistant, researcher],
    });
  });

  it('sendMessage routes to the correct agent', async () => {
    const events: ProgressUpdate[] = [];
    for await (const update of sdk.chat.sendMessage('assistant', 'Hello')) {
      events.push(update);
    }
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent?.content).toBe('Hello from Assistant.');
  });

  it('different agents give different responses', async () => {
    const assistantEvents: ProgressUpdate[] = [];
    for await (const update of sdk.chat.sendMessage('assistant', 'Hi')) {
      assistantEvents.push(update);
    }

    const researcherEvents: ProgressUpdate[] = [];
    for await (const update of sdk.chat.sendMessage('researcher', 'Hi')) {
      researcherEvents.push(update);
    }

    expect(assistantEvents.find((e) => e.type === 'done')?.content).toBe('Hello from Assistant.');
    expect(researcherEvents.find((e) => e.type === 'done')?.content).toBe('Research results here.');
  });

  it('dispatches events when chat completes', async () => {
    const startFn = vi.fn();
    const doneFn = vi.fn();

    sdk.chat.addEventListener('start', startFn as EventListener);
    sdk.chat.addEventListener('done', doneFn as EventListener);

    for await (const _update of sdk.chat.sendMessage('assistant', 'Hello')) {
      // consume stream
    }

    expect(startFn).toHaveBeenCalled();
    expect(doneFn).toHaveBeenCalled();
  });

  it('throws when agent not registered and no engine', async () => {
    const stream = sdk.chat.sendMessage('unknown-agent', 'Hello');
    await expect(async () => {
      for await (const _update of stream) { /* consume */ }
    }).rejects.toThrow('no agent registered');
  });

  it('registerAgent allows adding agents after construction', async () => {
    const newAgent = createAgent({
      id: 'writer',
      name: 'Writer',
      model: mockModel({ responses: [{ text: 'Written content.' }] }),
    });

    sdk.chat.registerAgent(newAgent);

    const events: ProgressUpdate[] = [];
    for await (const update of sdk.chat.sendMessage('writer', 'Write something')) {
      events.push(update);
    }
    expect(events.find((e) => e.type === 'done')?.content).toBe('Written content.');
  });

  it('FilesAPI works with InMemoryMemoryStore directly', async () => {
    await sdk.files.write('agent-1', 'test.md', 'hello world');
    const content = await sdk.files.read('agent-1', 'test.md');
    expect(content).toBe('hello world');

    const entries = await sdk.files.list('agent-1');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.name === 'test.md')).toBe(true);

    await sdk.files.delete('agent-1', 'test.md');
    await expect(sdk.files.read('agent-1', 'test.md')).rejects.toThrow();
  });

  it('FilesAPI emits events', async () => {
    const writtenFn = vi.fn();
    const deletedFn = vi.fn();

    sdk.files.addEventListener('written', writtenFn as EventListener);
    sdk.files.addEventListener('deleted', deletedFn as EventListener);

    await sdk.files.write('agent-1', 'event-test.md', 'data');
    expect(writtenFn).toHaveBeenCalledTimes(1);

    await sdk.files.delete('agent-1', 'event-test.md');
    expect(deletedFn).toHaveBeenCalledTimes(1);
  });
});
