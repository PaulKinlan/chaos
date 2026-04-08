/**
 * streaming.ts — Streaming agent events.
 *
 * Creates an agent and streams a task, printing each ProgressEvent as it
 * arrives. Demonstrates the AsyncIterable API with event types like
 * 'thinking', 'text', 'step-complete', and 'done'.
 *
 * Run: npx tsx examples/streaming.ts
 *      npx tsx examples/streaming.ts --provider anthropic
 */

import { createAgent } from '@chaos/agent-loop';
import { resolveModel } from './lib/model.js';

const model = await resolveModel([
  { text: 'Streaming works! Here is the answer to your question.' },
]);

const agent = createAgent({
  id: 'streamer',
  name: 'Streaming Agent',
  model,
  systemPrompt: 'You are a helpful assistant.',
});

console.log('Streaming events:\n');

for await (const event of agent.stream('Tell me something interesting.')) {
  const label = event.type.toUpperCase().padEnd(15);
  const step = event.step !== undefined ? `[step ${event.step}] ` : '';
  console.log(`${label} ${step}${event.content}`);
}
