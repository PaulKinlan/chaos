/**
 * abort-demo.ts — Aborting a long-running agent.
 *
 * Creates an agent with a slow tool, starts a task, then aborts it after a
 * short timeout. Demonstrates how AbortSignal integrates with the agent loop.
 *
 * Run: npx tsx examples/abort-demo.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import { tool } from 'ai';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const slowTask = tool({
  description: 'A task that takes a long time.',
  inputSchema: s(z.object({ duration: z.number().describe('Seconds to wait') })),
  execute: async ({ duration }: { duration: number }) => {
    console.log(`  [slowTask] starting ${duration}s task...`);
    await new Promise((r) => setTimeout(r, duration * 1000));
    console.log('  [slowTask] finished');
    return 'Task complete';
  },
});

const model = createMockModel({
  responses: [
    { toolCalls: [{ toolName: 'slowTask', args: { duration: 10 } }] },
    { text: 'All done!' },
  ],
});

// Use AbortController for timeout-based cancellation
const controller = new AbortController();

const agent = createAgent({
  id: 'abortable',
  name: 'Abortable Agent',
  model,
  tools: { slowTask },
  signal: controller.signal,
});

console.log('Starting agent (will abort after 500ms)...\n');

// Set a timeout to abort
setTimeout(() => {
  console.log('\n  [abort] Sending abort signal!');
  controller.abort();
}, 500);

try {
  for await (const event of agent.stream('Run the slow task for 10 seconds.')) {
    console.log(`  [${event.type}] ${event.content}`);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('abort')) {
    console.log('\nAgent was aborted as expected.');
  } else {
    console.log('\nAgent stopped with error:', msg);
  }
}
