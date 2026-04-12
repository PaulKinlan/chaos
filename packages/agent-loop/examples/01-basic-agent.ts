/**
 * Example 1: Basic Agent
 *
 * The simplest possible agent — just a model and a task.
 *
 * Run: npx tsx examples/01-basic-agent.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const agent = createAgent({
  id: 'assistant',
  name: 'Assistant',
  model: model as any,
  systemPrompt: 'You are a helpful assistant. Be concise.',
  maxIterations: 5,
});

// Non-streaming
const result = await agent.run('What is the capital of France?');
console.log(result);

// Streaming
for await (const event of agent.stream('Tell me a short joke')) {
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n--- Done ---');
}
