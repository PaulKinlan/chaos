/**
 * Example 7: Multi-Agent Orchestration
 *
 * A master agent coordinates specialist workers. The master receives
 * three delegation tools:
 *   - delegate_task(agentId, task) → runs the worker and returns its result
 *   - list_agents() → shows all available workers
 *   - get_agent_status(agentId) → checks a worker's status
 *
 * This example runs TWO separate tasks to show the difference:
 *   Task 1: orchestrator.run() — synchronous, returns final text
 *   Task 2: orchestrator.stream() — shows events as master + workers execute
 *
 * Run: npx tsx examples/07-multi-agent-orchestration.ts
 */

import { createOrchestrator } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

console.log('═══════════════════════════════════════════════');
console.log('  Example 7: Multi-Agent Orchestration');
console.log('═══════════════════════════════════════════════\n');

const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

console.log('Setting up orchestrator:');
console.log('  Master:     claude-sonnet-4-6 (coordinates work)');
console.log('  Researcher: claude-haiku-4-5  (finds information)');
console.log('  Writer:     claude-haiku-4-5  (drafts content)\n');

const orchestrator = createOrchestrator({
  master: {
    id: 'master',
    name: 'Master',
    model: provider('claude-sonnet-4-6') as any,
    systemPrompt: `You are a master agent. You coordinate specialist workers.
Available workers:
- researcher: finds and summarizes information
- writer: drafts clear, concise content

For complex tasks, delegate to the appropriate specialist using delegate_task.
For simple tasks, handle them directly.`,
    maxIterations: 5,
  },
  workers: [
    {
      id: 'researcher',
      name: 'Researcher',
      model: provider('claude-haiku-4-5') as any,
      systemPrompt: 'You are a research specialist. Find and summarize information concisely.',
      maxIterations: 3,
    },
    {
      id: 'writer',
      name: 'Writer',
      model: provider('claude-haiku-4-5') as any,
      systemPrompt: 'You are a writing specialist. Draft clear, concise content.',
      maxIterations: 3,
    },
  ],
});

// ══════════════════════════════════════════
// Task 1: Synchronous run()
// ══════════════════════════════════════════

console.log('══════════════════════════════════════════');
console.log('  TASK 1: orchestrator.run() (synchronous)');
console.log('══════════════════════════════════════════');
console.log('  Sending: "Write a brief summary about TypeScript"');
console.log('  The master decides: handle directly or delegate to a worker.');
console.log('  run() returns the final text — we don\'t see intermediate steps.\n');

const result = await orchestrator.run('Write a brief summary about TypeScript');
console.log('  Master\'s response:');
console.log(`  ${result}\n`);

// ══════════════════════════════════════════
// Task 2: Streaming
// ══════════════════════════════════════════

console.log('══════════════════════════════════════════');
console.log('  TASK 2: orchestrator.stream() (streaming)');
console.log('══════════════════════════════════════════');
console.log('  Sending: "Research React and write a paragraph about it"');
console.log('  This task is complex — the master will likely:');
console.log('    1. Call delegate_task to send research to the Researcher');
console.log('    2. Receive the research results');
console.log('    3. Either delegate writing to Writer or compile the answer');
console.log('  We see every event as it happens.\n');

let currentStep = 0;
for await (const event of orchestrator.stream('Research React and write a paragraph about it')) {
  switch (event.type) {
    case 'thinking':
      if (event.step !== undefined && event.step !== currentStep) {
        currentStep = event.step;
        console.log(`\n  ── Step ${currentStep} ──`);
      }
      break;
    case 'tool-call':
      console.log(`  [MASTER] Calling: ${event.toolName}`);
      if (event.toolArgs) {
        const args = event.toolArgs as Record<string, unknown>;
        if (args.agentId) console.log(`           Delegating to: ${args.agentId}`);
        if (args.task) console.log(`           Task: "${String(args.task).slice(0, 80)}..."`);
      }
      break;
    case 'tool-result':
      if (event.toolResult) {
        const result = String(event.toolResult);
        console.log(`  [RESULT] ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
      }
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}

console.log('✓ Both tasks completed.');
console.log('  Task 1 used run() — simple, returns final text.');
console.log('  Task 2 used stream() — shows the master delegating to workers in real-time.');
