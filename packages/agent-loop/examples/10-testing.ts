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

// Mock model returns predetermined responses
const model = createMockModel({
  responses: [
    // First call: agent calls a tool
    {
      toolCalls: [
        { toolName: 'write_file', args: { path: 'notes/test.md', content: '# Test\nThis is a test note.' } },
      ],
    },
    // Second call: agent responds with text
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

// Run the agent — it will use predetermined responses
const result = await agent.run('Save a test note');
console.log('Result:', result);

// Verify the side effects
const saved = await memory.read('test-agent', 'notes/test.md');
console.log('Saved file:', saved);

// Assert
console.assert(result === 'I saved a test note to notes/test.md.', 'Result should match');
console.assert(saved === '# Test\nThis is a test note.', 'File should be saved');
console.log('All assertions passed!');
