/**
 * Example 6: Multi-turn Conversations
 *
 * Pass conversation history to maintain context across messages.
 * The agent sees previous user/assistant turns.
 *
 * Run: npx tsx examples/06-conversation-history.ts
 */

import { createAgent, type ConversationMessage } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const agent = createAgent({
  id: 'chat-agent',
  name: 'Chat Agent',
  model: model as any,
  systemPrompt: 'You are a helpful assistant. Remember what the user tells you.',
  maxIterations: 5,
});

// Accumulate conversation history
const history: ConversationMessage[] = [];

async function chat(message: string): Promise<string> {
  console.log(`\nYou: ${message}`);

  // Pass history so the agent sees previous turns
  const response = await agent.run(message, undefined, history);

  // Add both messages to history for next turn
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: response });

  console.log(`Agent: ${response}`);
  return response;
}

// Multi-turn conversation
await chat('My name is Alice and I live in Tokyo.');
await chat('What is my name?');  // Agent should remember "Alice"
await chat('Where do I live?');  // Agent should remember "Tokyo"
