# Getting Started with @chaos/agent-loop

## Installation

```bash
npm install @chaos/agent-loop ai zod
```

You also need a model provider. For example, to use Anthropic:

```bash
npm install @ai-sdk/anthropic
```

## Create Your First Agent

```typescript
import { createAgent } from '@chaos/agent-loop';
import { anthropic } from '@ai-sdk/anthropic';

const agent = createAgent({
  id: 'my-agent',
  name: 'My Agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 10,
});

// Run to completion
const result = await agent.run('What is the capital of France?');
console.log(result); // "The capital of France is Paris."
```

## Add Custom Tools

Tools use the Vercel AI SDK `tool()` function:

```typescript
import { createAgent } from '@chaos/agent-loop';
import { anthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';

const agent = createAgent({
  id: 'tool-agent',
  name: 'Tool Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: {
    get_weather: tool({
      description: 'Get the current weather for a city.',
      inputSchema: z.object({
        city: z.string().describe('City name'),
      }),
      execute: async ({ city }) => {
        return `The weather in ${city} is sunny and 22C.`;
      },
    }),
  },
});

const result = await agent.run('What is the weather in Tokyo?');
```

## Stream Responses

Use `stream()` to get real-time progress events:

```typescript
for await (const event of agent.stream('Analyze this codebase')) {
  switch (event.type) {
    case 'thinking':
      process.stdout.write(event.content);
      break;
    case 'tool-call':
      console.log(`Calling ${event.toolName}...`);
      break;
    case 'tool-result':
      console.log(`Got result from ${event.toolName}`);
      break;
    case 'text':
      console.log('\nFinal:', event.content);
      break;
    case 'step-complete':
      console.log(`Step ${event.step! + 1} complete`);
      break;
    case 'done':
      console.log('\nDone!');
      break;
    case 'error':
      console.error('Error:', event.content);
      break;
  }
}
```

## Add Hooks

Hooks let you observe and control the agent lifecycle:

```typescript
const agent = createAgent({
  id: 'hooked-agent',
  name: 'Hooked Agent',
  model: anthropic('claude-sonnet-4-5'),
  hooks: {
    onPreToolUse: async (event) => {
      console.log(`About to call ${event.toolName} with`, event.args);
      // Return { decision: 'deny' } to block the call
      // Return { decision: 'allow', modifiedArgs: {...} } to modify args
      return { decision: 'allow' };
    },
    onPostToolUse: async (event) => {
      console.log(`${event.toolName} took ${event.durationMs}ms`);
    },
    onStepStart: async (event) => {
      console.log(`Step ${event.step}/${event.totalSteps}, cost so far: $${event.costSoFar.toFixed(4)}`);
      // Return { decision: 'stop' } to halt execution
    },
    onComplete: async (event) => {
      console.log(`Done in ${event.totalSteps} steps, total cost: $${event.usage.totalCost.toFixed(4)}`);
    },
    onUsage: async (record) => {
      // Persist usage records to your database
      await db.insert('usage', record);
    },
  },
});
```

## Set Permissions

Control which tools the agent can use:

```typescript
const agent = createAgent({
  id: 'safe-agent',
  name: 'Safe Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: { /* ... */ },
  permissions: {
    mode: 'ask', // 'accept-all' | 'deny-all' | 'ask'
    tools: {
      read_file: 'always',   // always allow
      write_file: 'ask',     // ask the callback
      delete_file: 'never',  // always deny
    },
    onPermissionRequest: async ({ toolName, args }) => {
      // Show a prompt to the user, return true/false
      return confirm(`Allow ${toolName}?`);
    },
  },
});
```

## Usage Tracking and Spending Limits

```typescript
const agent = createAgent({
  id: 'tracked-agent',
  name: 'Tracked Agent',
  model: anthropic('claude-sonnet-4-5'),
  usage: {
    enabled: true,
    limits: {
      perRun: 0.50,  // Max $0.50 per run
      perDay: 5.00,  // Max $5.00 per day
    },
    onLimitExceeded: async ({ type, spent, limit }) => {
      console.warn(`${type} limit exceeded: $${spent.toFixed(2)} / $${limit.toFixed(2)}`);
      return false; // Return true to continue anyway
    },
  },
});
```

## Abort a Running Agent

```typescript
const agent = createAgent({ /* ... */ });

// Start streaming in the background
const stream = agent.stream('Do something long');

// Abort after 5 seconds
setTimeout(() => agent.abort(), 5000);

for await (const event of stream) {
  if (event.type === 'error' && event.content === 'Aborted') {
    console.log('Agent was aborted');
    break;
  }
}
```

## Using the Lower-Level API

If you need more control, use `runAgentLoop` and `streamAgentLoop` directly:

```typescript
import { runAgentLoop, streamAgentLoop } from '@chaos/agent-loop';
import { anthropic } from '@ai-sdk/anthropic';

const config = {
  id: 'direct',
  name: 'Direct',
  model: anthropic('claude-sonnet-4-5'),
  maxIterations: 5,
};

// Direct run
const result = await runAgentLoop(config, 'Summarize this', 'optional context');
console.log(result.text);
console.log(`Cost: $${result.usage.totalCost.toFixed(4)}`);

// Streaming
for await (const event of streamAgentLoop(config, 'Summarize this')) {
  // handle events
}
```
