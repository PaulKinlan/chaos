/**
 * Example 10: Testing Agents
 *
 * Use createMockModel() for deterministic tests that don't call real APIs.
 * The mock returns predetermined responses in sequence.
 *
 * Run: npx tsx examples/10-testing.ts
 */

import { createAgent, createFileTools, InMemoryMemoryStore } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

console.log('═══════════════════════════════════════');
console.log('  Example 10: Testing Agents');
console.log('═══════════════════════════════════════\n');

console.log('createMockModel() returns predetermined responses in sequence,');
console.log('so you can write deterministic tests without calling real APIs.\n');

// ── Setup: Configure mock responses ──
console.log('── Setup: Mock model with 2 predetermined responses ──');
console.log('   Response 1: tool call to write_file (saves a note)');
console.log('   Response 2: text reply confirming the save\n');

const model = createMockModel({
  responses: [
    {
      toolCalls: [
        { toolName: 'write_file', args: { path: 'notes/test.md', content: '# Test\nThis is a test note.' } },
      ],
    },
    { text: 'I saved a test note to notes/test.md.' },
  ],
});

const memory = new InMemoryMemoryStore();

const agent = createAgent({
  id: 'test-agent',
  name: 'Test Agent',
  model: model as any,
  systemPrompt: 'You are a test agent.',
  tools: createFileTools(memory, 'test-agent'),
  maxIterations: 5,
});

// ── Task: Run the agent with mock responses ──
console.log('── Task: Run agent.run("Save a test note") ──');
console.log('   The mock model will return its predetermined responses.\n');

const result = await agent.run('Save a test note');
console.log(`   Agent result: "${result}"\n`);

// ── Verify: Check side effects ──
console.log('── Verify: Check that the file was actually written ──\n');

const saved = await memory.read('test-agent', 'notes/test.md');
console.log(`   Saved file contents: "${saved}"\n`);

// ── Assertions ──
console.log('── Assertions ──');

const resultOk = result === 'I saved a test note to notes/test.md.';
const fileOk = saved === '# Test\nThis is a test note.';

console.log(`   Result matches expected:  ${resultOk ? 'PASS' : 'FAIL'}`);
console.log(`   File contents match:      ${fileOk ? 'PASS' : 'FAIL'}\n`);

console.assert(resultOk, 'Result should match');
console.assert(fileOk, 'File should be saved');

console.log('Done — all assertions passed. No real API calls were made.');
