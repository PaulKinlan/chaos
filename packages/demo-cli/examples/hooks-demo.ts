/**
 * hooks-demo.ts — Agent with lifecycle hooks.
 *
 * Demonstrates onPreToolUse (log + optionally block), onPostToolUse (timing),
 * onStepStart (step count guard), and onComplete (summary). Shows the hook
 * decision system with 'allow', 'deny', and 'continue' decisions.
 *
 * Run: npx tsx examples/hooks-demo.ts
 *      npx tsx examples/hooks-demo.ts --provider anthropic
 */

import { createAgent, type AgentHooks } from '@chaos/agent-loop';
import { resolveModel, isRealProvider } from './lib/model.js';
import { tool } from 'ai';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const greet = tool({
  description: 'Greet someone by name.',
  inputSchema: s(z.object({ name: z.string() })),
  execute: async ({ name }: { name: string }) => `Hello, ${name}!`,
});

const banned = tool({
  description: 'A tool that should be blocked by hooks.',
  inputSchema: s(z.object({})),
  execute: async () => 'This should never run.',
});

const hooks: AgentHooks = {
  onPreToolUse: async (event) => {
    console.log(`  [hook:pre]  tool="${event.toolName}" step=${event.step}`);
    if (event.toolName === 'banned') {
      console.log('  [hook:pre]  BLOCKING banned tool');
      return { decision: 'deny', reason: 'This tool is not allowed' };
    }
    return { decision: 'allow' };
  },
  onPostToolUse: async (event) => {
    console.log(`  [hook:post] tool="${event.toolName}" took ${event.durationMs}ms`);
  },
  onStepStart: async (event) => {
    console.log(`  [hook:step] step ${event.step + 1}/${event.totalSteps} (cost so far: $${event.costSoFar.toFixed(4)})`);
    if (event.step >= 5) {
      console.log('  [hook:step] STOPPING - too many steps');
      return { decision: 'stop', reason: 'Step limit reached' };
    }
    return { decision: 'continue' };
  },
  onComplete: async (event) => {
    console.log(`\n  [hook:done] Completed in ${event.totalSteps} step(s), aborted=${event.aborted}`);
    console.log(`  [hook:done] Total tokens: ${event.usage.totalInputTokens + event.usage.totalOutputTokens}`);
  },
};

const model = await resolveModel([
  { toolCalls: [{ toolName: 'greet', args: { name: 'World' } }] },
  { text: 'Greeting sent successfully!' },
]);

const agent = createAgent({
  id: 'hooked',
  name: 'Hooked Agent',
  model,
  tools: { greet, banned },
  hooks,
});

// Use a more natural prompt for real providers
const prompt = isRealProvider()
  ? 'Use the greet tool to greet "World".'
  : 'Greet the world';

console.log('Running agent with lifecycle hooks...\n');
const result = await agent.run(prompt);
console.log('\nAgent response:', result);
