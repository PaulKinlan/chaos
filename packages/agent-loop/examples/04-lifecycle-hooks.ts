/**
 * Example 4: Lifecycle Hooks
 *
 * Hooks let you intercept tool calls, track usage, enforce limits,
 * and modify agent behavior at runtime.
 *
 * Run: npx tsx examples/04-lifecycle-hooks.ts
 */

import { createAgent, InMemoryMemoryStore, createFileTools } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');
const memory = new InMemoryMemoryStore();

const agent = createAgent({
  id: 'monitored-agent',
  name: 'Monitored Agent',
  model: model as any,
  systemPrompt: 'You are a helpful agent. Save notes to your memory.',
  tools: createFileTools(memory, 'monitored-agent'),
  maxIterations: 10,
  hooks: {
    // Called before each tool is executed
    onPreToolUse: async (event) => {
      console.log(`[hook] About to call: ${event.toolName}`);

      // Block dangerous operations
      if (event.toolName === 'delete_file') {
        console.log('[hook] Blocked delete_file!');
        return { decision: 'deny', reason: 'Deletion not allowed' };
      }

      // Modify tool arguments
      if (event.toolName === 'write_file') {
        console.log('[hook] Allowing write_file');
        return { decision: 'allow' };
      }

      return { decision: 'allow' };
    },

    // Called after each tool completes
    onPostToolUse: async (event) => {
      console.log(`[hook] ${event.toolName} completed in ${event.durationMs}ms`);
    },

    // Called at the start of each iteration
    onStepStart: async (event) => {
      console.log(`[hook] Step ${event.step} starting (${event.tokensSoFar} tokens so far, $${event.costSoFar.toFixed(4)})`);

      // Stop after spending too much
      if (event.costSoFar > 0.10) {
        return { decision: 'stop', reason: 'Budget exceeded' };
      }
      return { decision: 'continue' };
    },

    // Called when the agent finishes
    onComplete: async (event) => {
      console.log(`[hook] Agent finished in ${event.totalSteps} steps`);
      console.log(`[hook] Total cost: $${event.usage.totalCost.toFixed(4)}`);
      console.log(`[hook] Tokens: ${event.usage.totalInputTokens} in, ${event.usage.totalOutputTokens} out`);
    },

    // Called after each LLM call with token usage
    onUsage: async (record) => {
      console.log(`[usage] Step ${record.step}: ${record.inputTokens}+${record.outputTokens} tokens ($${record.estimatedCost.toFixed(4)})`);
    },
  },
});

for await (const event of agent.stream('Save a note about today being a great day, then try to delete it')) {
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}
