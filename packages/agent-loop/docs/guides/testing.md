# Testing Guide

## createMockModel

The `@chaos/agent-loop/testing` export provides `createMockModel` for deterministic agent testing. It wraps the AI SDK's `MockLanguageModelV3` with a simpler interface.

```typescript
import { createMockModel } from '@chaos/agent-loop/testing';
import { createAgent } from '@chaos/agent-loop';

const model = createMockModel({
  responses: [
    { text: 'The answer is 42.' },
  ],
});

const agent = createAgent({
  id: 'test-agent',
  name: 'Test Agent',
  model,
});

const result = await agent.run('What is the meaning of life?');
// result === 'The answer is 42.'
```

## Multi-Step Mock Sequences

Provide multiple responses to simulate a multi-step agent run. The mock model uses `responses[0]` for the first LLM call, `responses[1]` for the second, and so on. If the agent makes more calls than there are responses, the last response is reused.

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const model = createMockModel({
  responses: [
    // Step 1: Agent calls a tool
    {
      toolCalls: [
        { toolName: 'get_data', args: { id: '123' } },
      ],
    },
    // Step 2: Agent responds with text (no tool calls = done)
    {
      text: 'Based on the data, the answer is X.',
    },
  ],
});

const agent = createAgent({
  id: 'test',
  name: 'Test',
  model,
  tools: {
    get_data: tool({
      description: 'Get data by ID',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => `Data for ${id}: some value`,
    }),
  },
});

const result = await agent.run('Analyze item 123');
// Agent calls get_data, gets result, then produces final text
```

## Configuring Mock Token Counts

Control simulated usage for cost-tracking tests:

```typescript
const model = createMockModel({
  responses: [{ text: 'Hello' }],
  inputTokensPerCall: 100,
  outputTokensPerCall: 50,
  modelId: 'claude-sonnet-4-5',  // Used for pricing lookups
});
```

## Testing Hooks

Verify that hooks fire correctly:

```typescript
const hookCalls: string[] = [];

const agent = createAgent({
  id: 'hook-test',
  name: 'Hook Test',
  model: createMockModel({
    responses: [
      { toolCalls: [{ toolName: 'my_tool', args: {} }] },
      { text: 'Done' },
    ],
  }),
  tools: {
    my_tool: tool({
      description: 'Test tool',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    }),
  },
  hooks: {
    onStepStart: async (e) => { hookCalls.push(`step-start:${e.step}`); },
    onPreToolUse: async (e) => { hookCalls.push(`pre:${e.toolName}`); return { decision: 'allow' }; },
    onPostToolUse: async (e) => { hookCalls.push(`post:${e.toolName}:${e.durationMs}ms`); },
    onStepComplete: async (e) => { hookCalls.push(`step-complete:${e.step}`); },
    onComplete: async (e) => { hookCalls.push(`complete:${e.totalSteps}`); },
  },
});

await agent.run('Do something');
// hookCalls contains the expected sequence of hook invocations
```

## Testing Permissions

Test that permission logic works:

```typescript
import { evaluatePermission } from '@chaos/agent-loop';

// Test accept-all mode
const allowed = await evaluatePermission('read_file', {}, {
  mode: 'accept-all',
});
// allowed === true

// Test per-tool override
const denied = await evaluatePermission('delete_file', {}, {
  mode: 'accept-all',
  tools: { delete_file: 'never' },
});
// denied === false

// Test ask mode with callback
const asked = await evaluatePermission('write_file', { path: '/tmp/test' }, {
  mode: 'ask',
  onPermissionRequest: async ({ toolName }) => toolName === 'write_file',
});
// asked === true
```

## Testing with Real Stores

Use in-memory store implementations for integration tests:

```typescript
import { createAgent, createFileTools, InMemorySkillStore } from '@chaos/agent-loop';
import { InMemoryMemoryStore } from '@chaos/sdk/stores/in-memory';

const memoryStore = new InMemoryMemoryStore();
const skillStore = new InMemorySkillStore();

// Pre-populate the memory store
await memoryStore.write('test-agent', 'data.txt', 'Hello world');

const agent = createAgent({
  id: 'test-agent',
  name: 'Test Agent',
  model: createMockModel({
    responses: [
      { toolCalls: [{ toolName: 'read_file', args: { path: 'data.txt' } }] },
      { text: 'The file says: Hello world' },
    ],
  }),
  tools: {
    ...createFileTools(memoryStore, 'test-agent'),
  },
  skills: skillStore,
});

const result = await agent.run('Read data.txt');
// Agent reads the pre-populated file and produces output
```

## Testing Tips

- Always use `createMockModel` to avoid real API calls in tests
- Match your `responses` array length to the expected number of LLM calls (tool-call step + final text step)
- The last response in the array is reused if the agent makes additional calls
- Use `evaluatePermission` directly to unit-test permission logic without running the full agent loop
- Check `RunResult.usage` to verify cost tracking in tests
