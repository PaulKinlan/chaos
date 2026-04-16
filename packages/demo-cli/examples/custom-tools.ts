/**
 * custom-tools.ts — Agent with custom tools.
 *
 * Defines a calculator tool and a weather lookup tool (mock data) using Zod
 * schemas. The mock model calls the calculator, gets the result, then responds.
 *
 * Run: npx tsx examples/custom-tools.ts
 *      npx tsx examples/custom-tools.ts --provider anthropic
 */

import { createAgent } from 'agent-do';
import { resolveModel, isRealProvider } from './lib/model.js';
import { tool } from 'ai';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const calculator = tool({
  description: 'Evaluate a math expression.',
  inputSchema: s(z.object({ expression: z.string().describe('e.g. "2 + 2"') })),
  execute: async ({ expression }: { expression: string }) => {
    console.log(`  [calculator] evaluating: ${expression}`);
    const result = Function(`"use strict"; return (${expression})`)();
    return `Result: ${result}`;
  },
});

const weather = tool({
  description: 'Get current weather for a city.',
  inputSchema: s(z.object({ city: z.string() })),
  execute: async ({ city }: { city: string }) => {
    console.log(`  [weather] looking up: ${city}`);
    const data: Record<string, string> = {
      London: '15C, cloudy',
      Tokyo: '22C, sunny',
      'New York': '18C, partly cloudy',
    };
    return data[city] ?? 'No data available';
  },
});

const model = await resolveModel([
  { toolCalls: [{ toolName: 'calculator', args: { expression: '42 * 7' } }] },
  { text: '42 times 7 equals 294.' },
]);

const agent = createAgent({
  id: 'tooled',
  name: 'Tool Agent',
  model,
  tools: { calculator, weather },
});

// Use a more natural prompt for real providers so the LLM actually uses the tools
const prompt = isRealProvider()
  ? 'Use the calculator tool to compute 42 times 7, then tell me the result.'
  : 'What is 42 times 7?';

console.log('Running agent with custom tools...\n');
const result = await agent.run(prompt);
console.log('\nAgent response:', result);
