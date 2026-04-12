/**
 * Example 3: Agent with Memory (File Tools)
 *
 * Agents can read and write files using the built-in file tools.
 * The InMemoryMemoryStore is included — for persistence, implement
 * your own MemoryStore backed by a filesystem, database, or cloud storage.
 *
 * Run: npx tsx examples/03-agent-with-memory.ts
 */

import { createAgent, createFileTools, InMemoryMemoryStore } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

// In-memory store for this session (data lost on exit)
// For persistence, use a filesystem or database-backed store
const memory = new InMemoryMemoryStore();

// Pre-populate some data
await memory.write('my-agent', 'notes/greeting.md', '# Hello\nThis is a note the agent saved earlier.');
await memory.write('my-agent', 'config.json', '{"theme": "dark", "language": "en"}');

const agent = createAgent({
  id: 'my-agent',
  name: 'My Agent',
  model: model as any,
  systemPrompt: `You are a helpful agent with a private file system.
Use read_file, write_file, list_directory, and grep_file to manage your memory.
Your files persist across conversations.`,
  tools: {
    ...createFileTools(memory, 'my-agent'),
  },
  maxIterations: 10,
});

// The agent can read and write its own files
for await (const event of agent.stream('Read my notes/greeting.md file and update it with today\'s date')) {
  if (event.type === 'tool-call') console.log(`  [${event.toolName}] ${JSON.stringify(event.toolArgs)}`);
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}

// Verify the file was updated
const updated = await memory.read('my-agent', 'notes/greeting.md');
console.log('Updated file:', updated);
