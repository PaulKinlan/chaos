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

console.log('═══════════════════════════════════════');
console.log('  Example 4: Lifecycle Hooks');
console.log('═══════════════════════════════════════\n');

console.log('This example registers hooks that fire at every stage of the agent loop:');
console.log('  - onStepStart:    before each iteration (can enforce budgets)');
console.log('  - onPreToolUse:   before a tool runs (can allow, deny, or modify)');
console.log('  - onPostToolUse:  after a tool completes (timing info)');
console.log('  - onUsage:        after each LLM call (token counts)');
console.log('  - onComplete:     when the agent finishes (final stats)\n');

console.log('The hooks are configured to BLOCK delete_file calls.');
console.log('We will ask the agent to save a note, then try to delete it.\n');

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
    onPreToolUse: async (event) => {
      console.log(`   [HOOK: onPreToolUse] Tool: ${event.toolName}`);

      if (event.toolName === 'delete_file') {
        console.log('   [HOOK: onPreToolUse] DENIED — deletion is not allowed');
        return { decision: 'deny', reason: 'Deletion not allowed' };
      }

      if (event.toolName === 'write_file') {
        console.log('   [HOOK: onPreToolUse] ALLOWED — write_file is permitted');
      }

      return { decision: 'allow' };
    },

    onPostToolUse: async (event) => {
      console.log(`   [HOOK: onPostToolUse] ${event.toolName} completed in ${event.durationMs}ms`);
    },

    onStepStart: async (event) => {
      console.log(`\n   [HOOK: onStepStart] Step ${event.step} — ${event.tokensSoFar} tokens used, $${event.costSoFar.toFixed(4)} spent`);

      if (event.costSoFar > 0.10) {
        console.log('   [HOOK: onStepStart] STOPPING — budget of $0.10 exceeded');
        return { decision: 'stop', reason: 'Budget exceeded' };
      }
      return { decision: 'continue' };
    },

    onComplete: async (event) => {
      console.log(`\n   [HOOK: onComplete] Agent finished`);
      console.log(`     Steps:        ${event.totalSteps}`);
      console.log(`     Total cost:   $${event.usage.totalCost.toFixed(4)}`);
      console.log(`     Input tokens: ${event.usage.totalInputTokens}`);
      console.log(`     Output tokens: ${event.usage.totalOutputTokens}`);
    },

    onUsage: async (record) => {
      console.log(`   [HOOK: onUsage] Step ${record.step}: ${record.inputTokens} in + ${record.outputTokens} out ($${record.estimatedCost.toFixed(4)})`);
    },
  },
});

// ── Task: Save a note, then try to delete it ──
console.log('── Task ──');
console.log('   Sending: "Save a note about today being a great day, then try to delete it"');
console.log('   The agent will call write_file (allowed) then delete_file (blocked).\n');

for await (const event of agent.stream('Save a note about today being a great day, then try to delete it')) {
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}

console.log('Done — hooks intercepted every stage of the agent loop.');
console.log('  write_file was allowed; delete_file was denied by onPreToolUse.');
