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

console.log('═══════════════════════════════════════════════');
console.log('  Example 6: Multi-turn Conversations');
console.log('═══════════════════════════════════════════════\n');

console.log('This example sends three messages in sequence.');
console.log('Each message includes the full conversation history');
console.log('so the agent remembers what was said before.\n');

console.log('Messages:');
console.log('  1. "My name is Alice and I live in Tokyo."');
console.log('  2. "What is my name?"   (should recall Alice)');
console.log('  3. "Where do I live?"   (should recall Tokyo)\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const agent = createAgent({
  id: 'chat-agent',
  name: 'Chat Agent',
  model: model as any,
  systemPrompt: 'You are a helpful assistant. Remember what the user tells you.',
  maxIterations: 5,
});

const history: ConversationMessage[] = [];
let turnNumber = 0;

async function chat(message: string): Promise<string> {
  turnNumber++;
  console.log(`── Turn ${turnNumber} ──`);
  console.log(`   You:   ${message}`);

  const response = await agent.run(message, undefined, history);

  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: response });

  console.log(`   Agent: ${response}\n`);
  return response;
}

await chat('My name is Alice and I live in Tokyo.');
await chat('What is my name?');
await chat('Where do I live?');

console.log(`Done — ${turnNumber} turns completed.`);
console.log(`  History now contains ${history.length} messages (${history.length / 2} exchanges).`);
