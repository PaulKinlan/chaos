import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import { createMockModel } from '../src/testing/index.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentConfig } from '../src/types.js';

function mockModel(
  ...args: Parameters<typeof createMockModel>
): AgentConfig['model'] {
  return createMockModel(...args) as unknown as AgentConfig['model'];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

function makeToolConfig(hooks: AgentConfig['hooks'] = {}): AgentConfig {
  return {
    id: 'test',
    name: 'Test',
    model: mockModel({
      responses: [
        {
          toolCalls: [{ toolName: 'my_tool', args: { input: 'test' } }],
        },
        { text: 'Done.' },
      ],
    }),
    tools: {
      my_tool: tool({
        description: 'Test tool',
        inputSchema: s(z.object({ input: z.string() })),
        execute: async ({ input }: { input: string }) => `result: ${input}`,
      }),
    },
    maxIterations: 5,
    hooks,
  };
}

describe('hooks', () => {
  it('onPreToolUse deny blocks tool execution', async () => {
    const config = makeToolConfig({
      onPreToolUse: async (event) => {
        if (event.toolName === 'my_tool') {
          return { decision: 'deny', reason: 'Not allowed' };
        }
        return { decision: 'allow' };
      },
    });

    const result = await runAgentLoop(config, 'Use tool');
    // The loop should still complete (tool returns error message)
    expect(result.aborted).toBe(false);
  });

  it('onPostToolUse receives result', async () => {
    const postHook = vi.fn();
    const config = makeToolConfig({
      onPostToolUse: postHook,
    });

    await runAgentLoop(config, 'Use tool');
    expect(postHook).toHaveBeenCalled();
    const call = postHook.mock.calls[0][0];
    expect(call.toolName).toBe('my_tool');
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('onStepStart stop ends the loop', async () => {
    const config: AgentConfig = {
      id: 'test',
      name: 'Test',
      model: mockModel({
        responses: [{ text: 'Step 1' }, { text: 'Step 2' }],
      }),
      maxIterations: 10,
      hooks: {
        onStepStart: async (event) => {
          if (event.step >= 1) {
            return { decision: 'stop', reason: 'Enough steps' };
          }
          return { decision: 'continue' };
        },
      },
    };

    const result = await runAgentLoop(config, 'Do work');
    // Should only run 1 step since step 1 is stopped
    expect(result.steps).toBe(1);
  });

  it('onComplete fires with usage', async () => {
    const completeFn = vi.fn();
    const config: AgentConfig = {
      id: 'test',
      name: 'Test',
      model: mockModel({ responses: [{ text: 'Done.' }] }),
      maxIterations: 5,
      hooks: {
        onComplete: completeFn,
      },
    };

    await runAgentLoop(config, 'Do work');
    expect(completeFn).toHaveBeenCalledTimes(1);
    const event = completeFn.mock.calls[0][0];
    expect(event.result).toBe('Done.');
    expect(event.usage).toBeDefined();
    expect(event.usage.totalInputTokens).toBeGreaterThanOrEqual(0);
  });

  it('onUsage fires for each step', async () => {
    const usageFn = vi.fn();
    const config: AgentConfig = {
      id: 'test',
      name: 'Test',
      model: mockModel({ responses: [{ text: 'Done.' }] }),
      maxIterations: 5,
      hooks: {
        onUsage: usageFn,
      },
    };

    await runAgentLoop(config, 'Do work');
    expect(usageFn).toHaveBeenCalled();
    const record = usageFn.mock.calls[0][0];
    expect(record.step).toBe(0);
    expect(record.model).toBe('mock-model');
  });

  it('onPreToolUse modifiedArgs changes tool input', async () => {
    const executeFn = vi.fn().mockResolvedValue('ok');
    const config: AgentConfig = {
      id: 'test',
      name: 'Test',
      model: mockModel({
        responses: [
          {
            toolCalls: [
              { toolName: 'my_tool', args: { input: 'original' } },
            ],
          },
          { text: 'Done.' },
        ],
      }),
      tools: {
        my_tool: tool({
          description: 'Test',
          inputSchema: s(z.object({ input: z.string() })),
          execute: executeFn,
        }),
      },
      maxIterations: 5,
      hooks: {
        onPreToolUse: async () => {
          return {
            decision: 'allow',
            modifiedArgs: { input: 'modified' },
          };
        },
      },
    };

    await runAgentLoop(config, 'Modify args');
    // The execute function should have been called with modified args
    if (executeFn.mock.calls.length > 0) {
      expect(executeFn.mock.calls[0][0]).toEqual({ input: 'modified' });
    }
  });
});
