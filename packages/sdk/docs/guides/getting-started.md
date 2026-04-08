# Getting Started with @chaos/sdk

## Installation

```bash
npm install @chaos/sdk
```

## Create an SDK Instance

The SDK requires store implementations for all data backends. Use the built-in in-memory stores for development:

```typescript
import { ChaosSDK } from '@chaos/sdk';
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '@chaos/sdk/stores/in-memory';

const sdk = new ChaosSDK({
  settings: new InMemorySettingsStore(),
  memory: new InMemoryMemoryStore(),
  conversations: new InMemoryConversationStore(),
  hooks: new InMemoryHookStore(),
  usage: new InMemoryUsageStore(),
  agentStore: new InMemoryAgentStore(),
});
```

## Register Agents

You can register pre-configured agent-loop instances from `@chaos/agent-loop`:

```typescript
import { createAgent } from '@chaos/agent-loop';
import { anthropic } from '@ai-sdk/anthropic';

const agent = createAgent({
  id: 'assistant',
  name: 'Assistant',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt: 'You are a helpful assistant.',
});

// Register at construction time
const sdk = new ChaosSDK({
  // ... stores ...
  agents: [agent],
});

// Or register after construction
sdk.chat.registerAgent(agent);
```

## Store Agent Metadata

```typescript
// Add agent metadata to the store
await sdk.agents.update('assistant', {
  id: 'assistant',
  name: 'Assistant',
  role: 'General-purpose helper',
  visibility: 'visible',
  createdAt: new Date().toISOString(),
});

// List all agents
const agents = await sdk.agents.list();
console.log(agents);
```

## Send Messages

Use `sendMessage` to talk to a registered agent. It returns an async iterable of progress updates:

```typescript
for await (const update of sdk.chat.sendMessage('assistant', 'Hello, how are you?')) {
  switch (update.type) {
    case 'thinking':
      process.stdout.write(update.content);
      break;
    case 'text':
      console.log('\nResponse:', update.content);
      break;
    case 'tool-call':
      console.log(`Calling ${update.toolName}...`);
      break;
    case 'tool-result':
      console.log(`Result from ${update.toolName}`);
      break;
    case 'done':
      console.log('\nDone!');
      break;
    case 'error':
      console.error('Error:', update.content);
      break;
  }
}
```

## Stop a Running Chat

```typescript
await sdk.chat.stop('assistant');
```

## Listen for Events

All domain APIs extend `EventTarget`, so you can listen for events:

```typescript
sdk.chat.addEventListener('chunk', (e) => {
  const { agentId, chunk } = (e as CustomEvent).detail;
  console.log(`[${agentId}] ${chunk}`);
});

sdk.chat.addEventListener('done', (e) => {
  const { agentId, result } = (e as CustomEvent).detail;
  console.log(`[${agentId}] finished: ${result}`);
});

sdk.agents.addEventListener('created', (e) => {
  const agent = (e as CustomEvent).detail;
  console.log(`New agent: ${agent.name}`);
});
```

## Work with Files

Read and write files in agent memory:

```typescript
await sdk.files.write('assistant', 'notes.md', '# My Notes\n\nHello world');
const content = await sdk.files.read('assistant', 'notes.md');
const files = await sdk.files.list('assistant');
const exists = await sdk.files.exists('assistant', 'notes.md');
const matches = await sdk.files.search('assistant', 'Hello');
```

## Track Usage

```typescript
// Record usage
await sdk.usage.record({
  id: 'usage-1',
  timestamp: new Date().toISOString(),
  agentId: 'assistant',
  agentName: 'Assistant',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  estimatedCost: 0.001,
  source: 'chat',
});

// Get summary
const summary = await sdk.usage.getSummary();
console.log(`Total cost: $${summary.totalCost.toFixed(4)}`);

// Set spending limits
await sdk.usage.setSpendingLimit('assistant', 5.00);
```

## Manage Settings

```typescript
// Get settings
const settings = await sdk.settings.get();
// { activeProvider: 'anthropic', theme: 'system' }

// Update settings
await sdk.settings.update({
  activeProvider: 'openai',
  theme: 'dark',
});

// Store API keys
await sdk.settings.setApiKeys({
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
});
```
