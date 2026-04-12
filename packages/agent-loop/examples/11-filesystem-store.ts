/**
 * Example 11: Filesystem Memory Store
 *
 * Uses the built-in FilesystemMemoryStore to persist agent memory
 * to disk. Run this example, then explore the created files:
 *
 *   ls -la .agent-data/my-agent/
 *
 * You'll see the agent create directories, write files, search
 * for content, and build up a persistent memory across runs.
 *
 * Run: npx tsx examples/11-filesystem-store.ts
 */

import { createAgent, createFileTools, FilesystemMemoryStore } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';
import * as fs from 'node:fs';
import * as path from 'node:path';

console.log('═══════════════════════════════════════════════');
console.log('  Example 11: Filesystem Memory Store');
console.log('═══════════════════════════════════════════════\n');

const DATA_DIR = path.resolve('.agent-data');
console.log(`Storage directory: ${DATA_DIR}`);
console.log('Files will persist across runs. Delete .agent-data/ to reset.\n');

// ── Create the filesystem store ──
const store = new FilesystemMemoryStore(DATA_DIR);

console.log('── Setting up agent ──');
console.log('The agent gets file tools backed by the filesystem store.');
console.log('Available tools: read_file, write_file, list_directory,');
console.log('  delete_file, grep_file, find_files, append_file, edit_file,');
console.log('  mkdir, rename_file, file_info\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const agent = createAgent({
  id: 'my-agent',
  name: 'My Agent',
  model: model as any,
  systemPrompt: `You are a helpful agent with a persistent file system.
Your files are stored at ${DATA_DIR}/my-agent/.

Use your file tools to:
- Save notes and memories to files
- Organize information into directories
- Search across your files for information

Create a sensible directory structure:
- memories/ for facts you learn
- notes/ for general notes
- TODO.md for task tracking`,
  tools: createFileTools(store, 'my-agent'),
  maxIterations: 10,
});

// ── Task 1: Have the agent set up its workspace ──
console.log('══════════════════════════════════════════');
console.log('  TASK 1: Set up workspace');
console.log('══════════════════════════════════════════');
console.log('Asking the agent to create its directory structure');
console.log('and save some initial information.\n');

for await (const event of agent.stream(
  'Set up your workspace: create memories/, notes/, and a TODO.md with some example tasks. ' +
  'Also save a note about today being a test run of the filesystem store.'
)) {
  switch (event.type) {
    case 'tool-call':
      console.log(`  [tool] ${event.toolName}(${formatArgs(event.toolArgs)})`);
      break;
    case 'tool-result':
      console.log(`         → ${String(event.toolResult).slice(0, 80)}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}

// ── Show what was created ──
console.log('══════════════════════════════════════════');
console.log('  FILES CREATED ON DISK');
console.log('══════════════════════════════════════════');

showDirectory(path.join(DATA_DIR, 'my-agent'), '', DATA_DIR);

// ── Task 2: Ask the agent to recall what it stored ──
console.log('\n══════════════════════════════════════════');
console.log('  TASK 2: Recall stored information');
console.log('══════════════════════════════════════════');
console.log('Asking the agent to read back its files and summarize.\n');

for await (const event of agent.stream(
  'List all your files, then read your TODO.md and tell me what tasks you have.'
)) {
  switch (event.type) {
    case 'tool-call':
      console.log(`  [tool] ${event.toolName}(${formatArgs(event.toolArgs)})`);
      break;
    case 'tool-result':
      console.log(`         → ${String(event.toolResult).slice(0, 100)}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}

// ── Task 3: Search across files ──
console.log('══════════════════════════════════════════');
console.log('  TASK 3: Search across files');
console.log('══════════════════════════════════════════');
console.log('Asking the agent to search for content across all its files.\n');

for await (const event of agent.stream(
  'Search all your files for the word "test" and tell me where you found it.'
)) {
  switch (event.type) {
    case 'tool-call':
      console.log(`  [tool] ${event.toolName}(${formatArgs(event.toolArgs)})`);
      break;
    case 'tool-result':
      console.log(`         → ${String(event.toolResult).slice(0, 100)}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}

console.log('✓ Done. Explore the created files:');
console.log(`  ls -la ${DATA_DIR}/my-agent/`);
console.log(`  cat ${DATA_DIR}/my-agent/TODO.md`);
console.log(`  find ${DATA_DIR}/my-agent/ -type f`);
console.log('\nRun this example again — the agent will see its previous files!');

// ── Helpers ──

function formatArgs(args: unknown): string {
  if (!args) return '';
  if (typeof args === 'object') {
    return Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 30 ? `"${v.slice(0, 27)}..."` : JSON.stringify(v)}`)
      .join(', ');
  }
  return String(args);
}

function showDirectory(dir: string, indent: string, baseDir: string): void {
  if (!fs.existsSync(dir)) {
    console.log(`${indent}(empty — no files created)`);
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full);
    if (entry.isDirectory()) {
      console.log(`  ${indent}📁 ${rel}/`);
      showDirectory(full, indent + '  ', baseDir);
    } else {
      const size = fs.statSync(full).size;
      console.log(`  ${indent}📄 ${rel} (${size} bytes)`);
    }
  }
}
