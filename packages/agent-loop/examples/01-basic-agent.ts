/**
 * Example 1: Basic Agent
 *
 * The simplest possible agent — just a model and a task.
 * Demonstrates both run() (returns final text) and stream() (yields events).
 *
 * Run: npx tsx examples/01-basic-agent.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

console.log('═══════════════════════════════════════');
console.log('  Example 1: Basic Agent');
console.log('═══════════════════════════════════════\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const agent = createAgent({
  id: 'assistant',
  name: 'Assistant',
  model: model as any,
  systemPrompt: 'You are a helpful assistant. Be concise.',
  maxIterations: 5,
});

// ── Task 1: Non-streaming (run) ──
console.log('── Task 1: Non-streaming run() ──');
console.log('   Sending: "What is the capital of France?"');
console.log('   agent.run() sends the message and waits for the complete response.\n');

const result = await agent.run('What is the capital of France?');
console.log(`   Agent replied: ${result}\n`);

// ── Task 2: Streaming ──
console.log('── Task 2: Streaming stream() ──');
console.log('   Sending: "Tell me a short joke"');
console.log('   agent.stream() yields ProgressEvent objects as the agent works.');
console.log('   Events: thinking → text → done\n');

process.stdout.write('   Agent: ');
for await (const event of agent.stream('Tell me a short joke')) {
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}

console.log('✓ Done — both tasks completed.');
