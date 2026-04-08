import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChaosSDK } from '../../src/sdk.js';
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
    sdk = new ChaosSDK({
      // No engine — using agentLoop instead
      settings: new InMemorySettingsStore(),
      memory: memoryStore,
      conversations: new InMemoryConversationStore(),
      hooks: new InMemoryHookStore(),
      usage: new InMemoryUsageStore(),
      agents: new InMemoryAgentStore(),
      agentLoop: {
        model: mockModel({ responses: [{ text: 'Agent loop response.' }] }),
        maxIterations: 3,
      },
    });
  });

  it('sendAgentic works via agent-loop (no engine)', async () => {
    const events: ProgressUpdate[] = [];
    for await (const update of sdk.chat.sendAgentic('test-agent', 'Hello')) {
      events.push(update);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('done');

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent?.content).toBe('Agent loop response.');
  });

  it('dispatches events when chat completes', async () => {
    const startFn = vi.fn();
    const doneFn = vi.fn();
    const chunkFn = vi.fn();

    sdk.chat.addEventListener('start', startFn as EventListener);
    sdk.chat.addEventListener('done', doneFn as EventListener);
    sdk.chat.addEventListener('chunk', chunkFn as EventListener);

    for await (const _update of sdk.chat.sendAgentic('test-agent', 'Hello')) {
      // consume stream
    }

    expect(startFn).toHaveBeenCalled();
    expect(doneFn).toHaveBeenCalled();
  });

  it('throws when neither engine nor agentLoop configured', async () => {
    const bareSDK = new ChaosSDK({
      settings: new InMemorySettingsStore(),
      memory: new InMemoryMemoryStore(),
      conversations: new InMemoryConversationStore(),
      hooks: new InMemoryHookStore(),
      usage: new InMemoryUsageStore(),
      agents: new InMemoryAgentStore(),
    });

    const stream = bareSDK.chat.sendAgentic('test-agent', 'Hello');
    await expect(async () => {
      for await (const _update of stream) {
        // consume
      }
    }).rejects.toThrow('either agentLoop or engine must be configured');
  });

  it('FilesAPI works with InMemoryMemoryStore directly', async () => {
    await sdk.files.write('agent-1', 'test.md', 'hello world');
    const content = await sdk.files.read('agent-1', 'test.md');
    expect(content).toBe('hello world');

    const entries = await sdk.files.list('agent-1');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.name === 'test.md')).toBe(true);

    const results = await sdk.files.search('agent-1', 'hello');
    expect(results.length).toBeGreaterThanOrEqual(1);

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
