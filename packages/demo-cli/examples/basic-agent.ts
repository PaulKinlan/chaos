/**
 * basic-agent.ts — Simplest possible agent.
 *
 * Creates an agent with a mock model, runs a single task, and prints the result.
 * Shows how little code is needed to get an agent running.
 *
 * Run: npx tsx examples/basic-agent.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const model = createMockModel({
  responses: [{ text: 'The capital of France is Paris.' }],
});

const agent = createAgent({
  id: 'basic',
  name: 'Basic Agent',
  model,
  systemPrompt: 'You are a helpful assistant.',
});

const result = await agent.run('What is the capital of France?');
console.log('Agent response:', result);
