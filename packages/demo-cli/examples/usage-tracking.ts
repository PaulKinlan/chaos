/**
 * usage-tracking.ts — Agent with usage tracking.
 *
 * Runs an agent and prints the UsageTracker summary showing tokens, estimated
 * cost, and per-step breakdown. Also demonstrates spending limits that halt
 * execution when exceeded.
 *
 * Run: npx tsx examples/usage-tracking.ts
 *      npx tsx examples/usage-tracking.ts --provider anthropic
 */

import { createAgent, UsageTracker, type AgentHooks } from '@chaos/agent-loop';
import { resolveModel } from './lib/model.js';

const usageRecords: Array<{ step: number; input: number; output: number; cost: number }> = [];

const hooks: AgentHooks = {
  onUsage: async (record) => {
    usageRecords.push({
      step: record.step,
      input: record.inputTokens,
      output: record.outputTokens,
      cost: record.estimatedCost,
    });
  },
  onComplete: async (event) => {
    console.log('\n--- Usage Summary ---');
    console.log(`Steps:         ${event.usage.steps}`);
    console.log(`Input tokens:  ${event.usage.totalInputTokens}`);
    console.log(`Output tokens: ${event.usage.totalOutputTokens}`);
    console.log(`Total cost:    $${event.usage.totalCost.toFixed(6)}`);
    console.log('\nPer-step breakdown:');
    for (const r of usageRecords) {
      console.log(`  Step ${r.step}: ${r.input} in / ${r.output} out ($${r.cost.toFixed(6)})`);
    }
  },
};

const model = await resolveModel([{ text: 'Here is a thoughtful analysis of the topic.' }]);

const agent = createAgent({
  id: 'tracked',
  name: 'Tracked Agent',
  model,
  hooks,
  usage: {
    enabled: true,
    limits: {
      perRun: 0.50, // $0.50 spending cap
    },
    onLimitExceeded: async (event) => {
      console.log(`\n[LIMIT] ${event.type} limit exceeded: $${event.spent.toFixed(4)} >= $${event.limit.toFixed(4)}`);
      return false; // stop execution
    },
  },
});

console.log('Running agent with usage tracking...\n');
const result = await agent.run('Analyze the pros and cons of microservices.');
console.log('\nAgent response:', result);
