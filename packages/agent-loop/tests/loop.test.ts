import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, streamAgentLoop } from '../src/loop.js';
import { createMockModel } from '../src/testing/index.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentConfig, ProgressEvent } from '../src/types.js';

// Helper to cast mock model as LanguageModel
function mockModel(
  ...args: Parameters<typeof createMockModel>
): AgentConfig['model'] {
  return createMockModel(...args) as unknown as AgentConfig['model'];
}

function baseConfig(
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    model: mockModel({ responses: [{ text: 'Hello!' }] }),
    maxIterations: 5,
    ...overrides,
  };
}

describe('runAgentLoop', () => {
  it('basic run: model returns text, completes in 1 step', async () => {
    const config = baseConfig({
      model: mockModel({ responses: [{ text: 'Task complete.' }] }),
    });

    const result = await runAgentLoop(config, 'Do something');
    expect(result.text).toBe('Task complete.');
    expect(result.steps).toBe(1);
    expect(result.aborted).toBe(false);
  });

  it('multi-step: tool call then text', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (schema: z.ZodType): any => schema;
    const executeFn = vi.fn().mockResolvedValue('tool result');

    const config = baseConfig({
      model: mockModel({
        responses: [
          {
            toolCalls: [
              { toolName: 'my_tool', args: { input: 'test' } },
            ],
          },
          { text: 'Done with tool result.' },
        ],
      }),
      tools: {
        my_tool: tool({
          description: 'A test tool',
          inputSchema: s(z.object({ input: z.string() })),
          execute: executeFn,
        }),
      },
    });

    const result = await runAgentLoop(config, 'Use the tool');
    expect(result.steps).toBeGreaterThanOrEqual(1);
    expect(result.aborted).toBe(false);
  });

  it('max iterations: model keeps calling tools, hits limit', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (schema: z.ZodType): any => schema;

    const config = baseConfig({
      model: mockModel({
        responses: [
          {
            toolCalls: [
              { toolName: 'my_tool', args: { input: 'loop' } },
            ],
          },
        ],
      }),
      tools: {
        my_tool: tool({
          description: 'A test tool',
          inputSchema: s(z.object({ input: z.string() })),
          execute: async () => 'result',
        }),
      },
      maxIterations: 3,
    });

    const result = await runAgentLoop(config, 'Loop forever');
    expect(result.steps).toBeLessThanOrEqual(3);
  });

  it('abort signal stops the loop', async () => {
    const controller = new AbortController();
    // Abort immediately
    controller.abort();

    const config = baseConfig({
      model: mockModel({ responses: [{ text: 'Should not reach.' }] }),
      signal: controller.signal,
    });

    const result = await runAgentLoop(config, 'Do something');
    expect(result.aborted).toBe(true);
  });
});

describe('streamAgentLoop', () => {
  it('yields progress events', async () => {
    const config = baseConfig({
      model: mockModel({ responses: [{ text: 'Streamed.' }] }),
    });

    const events: ProgressEvent[] = [];
    for await (const event of streamAgentLoop(config, 'Stream test')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('thinking');
    expect(types).toContain('done');

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent?.content).toBe('Streamed.');
  });

  it('yields tool-call events', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (schema: z.ZodType): any => schema;

    const config = baseConfig({
      model: mockModel({
        responses: [
          {
            toolCalls: [
              { toolName: 'test_tool', args: { q: 'hello' } },
            ],
          },
          { text: 'Done.' },
        ],
      }),
      tools: {
        test_tool: tool({
          description: 'Test',
          inputSchema: s(z.object({ q: z.string() })),
          execute: async () => 'result',
        }),
      },
    });

    const events: ProgressEvent[] = [];
    for await (const event of streamAgentLoop(config, 'Test')) {
      events.push(event);
    }

    const toolCallEvents = events.filter((e) => e.type === 'tool-call');
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);
    expect(toolCallEvents[0].toolName).toBe('test_tool');
  });
});
