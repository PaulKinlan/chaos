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

console.log('═══════════════════════════════════════');
console.log('  Example 3: Agent with Memory');
console.log('═══════════════════════════════════════\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

// ── Setup: In-memory store with pre-populated data ──
console.log('── Setup ──');
console.log('   Creating an InMemoryMemoryStore (data lost on exit).');
console.log('   Pre-populating two files the agent can discover:\n');

const memory = new InMemoryMemoryStore();

await memory.write('my-agent', 'notes/greeting.md', '# Hello\nThis is a note the agent saved earlier.');
await memory.write('my-agent', 'config.json', '{"theme": "dark", "language": "en"}');

console.log('   - notes/greeting.md  (a markdown note)');
console.log('   - config.json        (a JSON config file)\n');

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

// ── Task: Read and update a file ──
console.log('── Task: Read and update a file ──');
console.log('   Sending: "Read my notes/greeting.md file and update it with today\'s date"');
console.log('   The agent will use file tools (read_file, write_file) to complete this.');
console.log('   Watch the tool calls as they happen:\n');

for await (const event of agent.stream('Read my notes/greeting.md file and update it with today\'s date')) {
  if (event.type === 'tool-call') console.log(`   [TOOL CALL] ${event.toolName}(${JSON.stringify(event.toolArgs)})`);
  if (event.type === 'tool-result') console.log(`   [TOOL RESULT] ${String(event.toolResult).slice(0, 100)}`);
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}

// ── Verify: Check the file was updated ──
console.log('── Verify: Reading the updated file directly from the memory store ──\n');

const updated = await memory.read('my-agent', 'notes/greeting.md');
console.log(`   File contents:\n   ${updated.replace(/\n/g, '\n   ')}\n`);

console.log('Done — the agent read and updated a file using its memory store.');
