/**
 * basic-agent.ts — Simplest possible agent.
 *
 * Creates an agent with a mock model, runs a single task, and prints the result.
 * Shows how little code is needed to get an agent running.
 *
 * Run: npx tsx examples/basic-agent.ts
 *      npx tsx examples/basic-agent.ts --provider anthropic
 */

import { createAgent } from 'agent-do';
import { resolveModel } from './lib/model.js';

const model = await resolveModel([{ text: 'The capital of France is Paris. [MOCK RESPONSE]' }]);

const agent = createAgent({
  id: 'basic',
  name: 'Basic Agent',
  model,
  systemPrompt: 'You are a helpful assistant.',
});

const result = await agent.run('What is the capital of France?');
console.log('Agent response:', result);
