/**
 * multi-step.ts — Multi-step autonomous agent.
 *
 * The mock model returns tool calls on the first two steps (simulating
 * research), then returns text on the final step. Demonstrates the
 * autonomous looping behavior where the agent keeps working until done.
 *
 * Run: npx tsx examples/multi-step.ts
 *      npx tsx examples/multi-step.ts --provider anthropic
 */

import { createAgent } from 'agent-do';
import { resolveModel, isRealProvider } from './lib/model.js';
import { tool } from 'ai';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const search = tool({
  description: 'Search for information on a topic. Returns a list of results.',
  inputSchema: s(z.object({ query: z.string() })),
  execute: async ({ query }: { query: string }) => {
    console.log(`  [search] "${query}"`);
    return `Found 3 results for "${query}": Result A, Result B, Result C.`;
  },
});

const summarize = tool({
  description: 'Summarize a body of text into key points.',
  inputSchema: s(z.object({ text: z.string() })),
  execute: async ({ text }: { text: string }) => {
    console.log(`  [summarize] processing ${text.length} chars`);
    return `Summary: The key points are X, Y, and Z.`;
  },
});

const model = await resolveModel([
  { toolCalls: [{ toolName: 'search', args: { query: 'climate change effects' } }] },
  { toolCalls: [{ toolName: 'summarize', args: { text: 'Result A, Result B, Result C' } }] },
  { text: 'Based on my research and summary, the key effects of climate change are X, Y, and Z.' },
]);

const agent = createAgent({
  id: 'multi',
  name: 'Multi-Step Agent',
  model,
  tools: { search, summarize },
  maxIterations: 10,
});

// Use a more natural prompt for real providers so the LLM drives the tool loop
const prompt = isRealProvider()
  ? 'Search for "climate change effects", then use the summarize tool on the results you find. Finally, give me a summary in your own words.'
  : 'Research climate change effects and summarize.';

console.log('Running multi-step agent...\n');

for await (const event of agent.stream(prompt)) {
  if (event.type === 'tool-call') {
    console.log(`  >> Tool call: ${event.toolName}`);
  } else if (event.type === 'step-complete') {
    console.log(`  -- ${event.content}`);
  } else if (event.type === 'done') {
    console.log(`\nFinal answer: ${event.content}`);
  }
}
