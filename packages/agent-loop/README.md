# @chaos/agent-loop

Provider-agnostic autonomous agent loop for JavaScript. Built on the [Vercel AI SDK](https://sdk.vercel.ai/), it drives any `LanguageModel` through a tool-use loop until the task is complete.

## Features

- **Provider-agnostic** -- works with any Vercel AI SDK `LanguageModel` (OpenAI, Anthropic, Google, Mistral, Ollama, etc.)
- **Autonomous loop** -- calls tools, reads results, and continues until the model responds without tool calls
- **Streaming and non-streaming** -- `stream()` yields `ProgressEvent`s as an `AsyncIterable`; `run()` returns the final text
- **Built-in file tools** -- `createFileTools()` gives agents read/write/search/delete backed by any `MemoryStore`
- **Skills system** -- install, search, and manage skill definitions that extend the agent's system prompt
- **Lifecycle hooks** -- intercept tool calls, track steps, modify arguments, or halt execution
- **Permission system** -- accept-all, deny-all, or ask mode with per-tool overrides
- **Usage tracking** -- built-in cost estimation for 50+ models with per-run and per-day spending limits
- **Testable** -- `createMockModel()` returns a mock `LanguageModel` with predetermined responses

## Install

```bash
npm install @chaos/agent-loop
```

Peer dependency: `ai` (Vercel AI SDK v6+).

## Quick Start

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const model = createMockModel({
  responses: [
    { text: 'The capital of France is Paris.' },
  ],
});

const agent = createAgent({
  id: 'geography',
  name: 'Geography Agent',
  model,
});

const result = await agent.run('What is the capital of France?');
console.log(result); // "The capital of France is Paris."
```

## Streaming

`stream()` returns an `AsyncIterable<ProgressEvent>` that yields events as the agent works:

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const model = createMockModel({
  responses: [
    { toolCalls: [{ toolName: 'lookup', args: { query: 'Paris' } }] },
    { text: 'Paris is the capital of France.' },
  ],
});

const agent = createAgent({
  id: 'geo',
  name: 'Geo',
  model,
  tools: {
    // ... your tools here
  },
});

for await (const event of agent.stream('Tell me about Paris')) {
  switch (event.type) {
    case 'thinking':
      process.stdout.write(event.content);
      break;
    case 'tool-call':
      console.log(`Calling ${event.toolName}`, event.toolArgs);
      break;
    case 'tool-result':
      console.log(`Result from ${event.toolName}:`, event.toolResult);
      break;
    case 'text':
      console.log('Agent says:', event.content);
      break;
    case 'step-complete':
      console.log(`Step ${event.step! + 1} complete`);
      break;
    case 'done':
      console.log('Final answer:', event.content);
      break;
    case 'error':
      console.error('Error:', event.content);
      break;
  }
}
```

### ProgressEvent types

| Type | Description |
|------|-------------|
| `thinking` | Partial text streaming from the model |
| `tool-call` | The model is calling a tool (`toolName`, `toolArgs`) |
| `tool-result` | A tool returned a result (`toolName`, `toolResult`) |
| `text` | Final text output for a step |
| `step-complete` | An iteration of the loop finished |
| `done` | The agent completed its task |
| `error` | Something went wrong or limits were exceeded |

## Multiple Agents

Create multiple agents with different models, tools, and system prompts:

```ts
import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const assistant = createAgent({
  id: 'assistant',
  name: 'Assistant',
  model: anthropic('claude-sonnet-4-6'),
  systemPrompt: 'You are a helpful assistant.',
});

const researcher = createAgent({
  id: 'researcher',
  name: 'Researcher',
  model: anthropic('claude-haiku-4-5'), // cheaper model for research
  systemPrompt: 'You are a research assistant. Be thorough.',
});

// Each agent has its own conversation context
const answer = await assistant.run('Hello!');
const research = await researcher.run('Find info about TypeScript');
```

## Tools

Define tools using the Vercel AI SDK's `tool()` function:

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import { tool } from 'ai';
import { z } from 'zod';

const agent = createAgent({
  id: 'math',
  name: 'Math Agent',
  model: createMockModel({
    responses: [
      { toolCalls: [{ toolName: 'add', args: { a: 2, b: 3 } }] },
      { text: 'The sum of 2 and 3 is 5.' },
    ],
  }),
  tools: {
    add: tool({
      description: 'Add two numbers',
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => `${a + b}`,
    }),
  },
});

const result = await agent.run('What is 2 + 3?');
```

The agent loops automatically: it calls tools, feeds results back to the model, and continues until the model responds with text only (no tool calls) or hits `maxIterations` (default: 20).

## File Tools

`createFileTools()` generates a set of file-manipulation tools backed by any `MemoryStore`:

```ts
import { createAgent, createFileTools, InMemoryMemoryStore } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const store = new InMemoryMemoryStore();
const fileTools = createFileTools(store, 'agent-1');

const agent = createAgent({
  id: 'writer',
  name: 'Writer',
  model: createMockModel({
    responses: [
      { toolCalls: [{ toolName: 'write_file', args: { path: 'hello.txt', content: 'Hello!' } }] },
      { text: 'File written.' },
    ],
  }),
  tools: fileTools,
});

await agent.run('Create a hello.txt file');
```

The generated tools are:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file's contents |
| `write_file` | Write content to a file (creates parent dirs) |
| `list_directory` | List files and directories at a path |
| `delete_file` | Delete a file |
| `grep_file` | Search for a text pattern across files |
| `find_files` | Recursively list all files from a path |

## MemoryStore

The `MemoryStore` interface abstracts file storage for agents. Two implementations are included:

- **`InMemoryMemoryStore`** — for testing and prototyping (data lost on exit)
- **`FilesystemMemoryStore`** — persists to the local filesystem (survives restarts)

```ts
import { FilesystemMemoryStore, createFileTools, createAgent } from '@chaos/agent-loop';

const store = new FilesystemMemoryStore('./agent-data');
const agent = createAgent({
  id: 'my-agent',
  name: 'My Agent',
  model: model as any,
  tools: createFileTools(store, 'my-agent'),
});
// Files persist at ./agent-data/my-agent/
```

For other backends, implement the interface:

```ts
interface MemoryStore {
  read(agentId: string, path: string): Promise<string>;
  write(agentId: string, path: string, content: string): Promise<void>;
  append(agentId: string, path: string, content: string): Promise<void>;
  delete(agentId: string, path: string): Promise<void>;
  list(agentId: string, path?: string): Promise<FileEntry[]>;
  mkdir(agentId: string, path: string): Promise<void>;
  exists(agentId: string, path: string): Promise<boolean>;
  search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>>;
}
```

### Custom implementations

See [`examples/08-custom-memory-store.ts`](examples/08-custom-memory-store.ts) for complete patterns for:
- **Node.js filesystem** (`fs`)
- **AWS S3** (`@aws-sdk/client-s3`)
- **Google Firestore** (`@google-cloud/firestore`)
- **SQLite** (`better-sqlite3`)

## Conversation History

Pass previous conversation turns to maintain context:

```ts
import { createAgent, type ConversationMessage } from '@chaos/agent-loop';

const history: ConversationMessage[] = [];

// First turn
const r1 = await agent.run('My name is Alice', undefined, history);
history.push({ role: 'user', content: 'My name is Alice' });
history.push({ role: 'assistant', content: r1 });

// Second turn — agent remembers the name
const r2 = await agent.run('What is my name?', undefined, history);
// r2 = "Your name is Alice."
```

## Skills

Skills extend an agent's system prompt with additional instructions. They can be installed, removed, searched, and managed through a `SkillStore`.

### Defining a skill

```ts
import type { Skill } from '@chaos/agent-loop';

const skill: Skill = {
  id: 'code-review',
  name: 'Code Review',
  description: 'Reviews code for quality and best practices',
  content: `When reviewing code:
- Check for error handling
- Look for security issues
- Suggest performance improvements`,
};
```

### Using InMemorySkillStore

```ts
import { createAgent, InMemorySkillStore } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const skills = new InMemorySkillStore();
await skills.install({
  id: 'code-review',
  name: 'Code Review',
  description: 'Reviews code for quality',
  content: 'When reviewing code, check for errors and suggest improvements.',
});

const agent = createAgent({
  id: 'reviewer',
  name: 'Reviewer',
  model: createMockModel({ responses: [{ text: 'LGTM' }] }),
  skills,
});
```

When a `SkillStore` is provided, the agent gets:
- Installed skill content injected into the system prompt
- Auto-generated tools: `search_skills`, `install_skill`, `list_skills`, `remove_skill`

### Parsing SKILL.md files

```ts
import { parseSkillMd } from '@chaos/agent-loop';

const skill = parseSkillMd(`---
name: My Skill
description: Does useful things
author: Alice
version: 1.0.0
---

Instructions for the skill go here.
`);

console.log(skill.name);    // "My Skill"
console.log(skill.content); // "Instructions for the skill go here."
```

### SkillStore interface

Implement `SkillStore` for custom backends (database, filesystem, API):

```ts
interface SkillStore {
  list(): Promise<Skill[]>;
  get(skillId: string): Promise<Skill | undefined>;
  install(skill: Skill): Promise<void>;
  remove(skillId: string): Promise<void>;
  search(query: string): Promise<Array<{ id: string; name: string; description: string; url?: string }>>;
}
```

## Lifecycle Hooks

Hooks let you observe and control the agent loop. All hooks are optional and async.

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const agent = createAgent({
  id: 'hooked',
  name: 'Hooked Agent',
  model: createMockModel({ responses: [{ text: 'Done.' }] }),
  hooks: {
    // Called before each tool execution. Return a HookDecision to allow/deny/modify.
    onPreToolUse: async ({ toolName, args, step }) => {
      console.log(`Step ${step}: about to call ${toolName}`);
      // Return { decision: 'deny', reason: 'not allowed' } to block
      // Return { decision: 'allow', modifiedArgs: { ... } } to modify input
      return { decision: 'allow' };
    },

    // Called after each tool execution.
    onPostToolUse: async ({ toolName, args, result, step, durationMs }) => {
      console.log(`${toolName} took ${durationMs}ms`);
    },

    // Called at the start of each loop iteration. Return 'stop' to halt.
    onStepStart: async ({ step, totalSteps, tokensSoFar, costSoFar }) => {
      if (costSoFar > 1.0) {
        return { decision: 'stop', reason: 'Too expensive' };
      }
    },

    // Called after each loop iteration completes.
    onStepComplete: async ({ step, hasToolCalls, text }) => {
      console.log(`Step ${step} done, has tools: ${hasToolCalls}`);
    },

    // Called when the entire run finishes.
    onComplete: async ({ result, totalSteps, usage, aborted }) => {
      console.log(`Finished in ${totalSteps} steps, cost: $${usage.totalCost.toFixed(4)}`);
    },

    // Called after each step's usage is recorded.
    onUsage: async (record) => {
      console.log(`Step ${record.step}: ${record.inputTokens}in/${record.outputTokens}out, $${record.estimatedCost.toFixed(4)}`);
    },
  },
});
```

### HookDecision

Returned from `onPreToolUse` and `onStepStart`:

```ts
interface HookDecision {
  decision: 'allow' | 'deny' | 'ask' | 'stop' | 'continue';
  reason?: string;
  modifiedArgs?: unknown; // Only for onPreToolUse: replace the tool's input
}
```

## Permissions

Control which tools the agent can call.

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const agent = createAgent({
  id: 'safe',
  name: 'Safe Agent',
  model: createMockModel({ responses: [{ text: 'Done.' }] }),
  permissions: {
    // Base mode: 'accept-all' | 'deny-all' | 'ask'
    mode: 'ask',

    // Per-tool overrides: 'always' | 'ask' | 'never'
    tools: {
      read_file: 'always',   // Always allowed, even in deny-all mode
      delete_file: 'never',  // Always blocked, even in accept-all mode
      write_file: 'ask',     // Falls through to onPermissionRequest
    },

    // Called when mode is 'ask' or a tool's level is 'ask'
    onPermissionRequest: async ({ toolName, args }) => {
      console.log(`Allow ${toolName}?`, args);
      return true; // or false to deny
    },
  },
});
```

### Permission evaluation order

1. If mode is `accept-all`, allow (but still check per-tool `never` overrides)
2. If mode is `deny-all`, deny (but still check per-tool `always` overrides)
3. Check per-tool override: `always` -> allow, `never` -> deny
4. If `ask` or no override: call `onPermissionRequest` (defaults to allow if no callback)

## Usage Tracking

Track token usage and costs across agent runs with built-in pricing for 50+ models.

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

const agent = createAgent({
  id: 'tracked',
  name: 'Tracked',
  model: createMockModel({ responses: [{ text: 'Hi' }] }),
  usage: {
    enabled: true,
    limits: {
      perRun: 0.50,  // $0.50 max per run
      perDay: 5.00,  // $5.00 max per day
    },
    // Called when a limit is exceeded. Return true to continue anyway.
    onLimitExceeded: async ({ type, spent, limit }) => {
      console.warn(`${type} limit exceeded: $${spent.toFixed(2)} / $${limit.toFixed(2)}`);
      return false; // stop the run
    },
    // Optional: override built-in pricing
    pricing: {
      'my-custom-model': { input: 1.0, output: 3.0 }, // per 1M tokens
    },
  },
});
```

### UsageTracker class

For standalone usage tracking outside of `createAgent`:

```ts
import { UsageTracker, estimateCost, DEFAULT_PRICING } from '@chaos/agent-loop';

const tracker = new UsageTracker({
  perRunLimit: 1.0,
});

// Record a step
const record = tracker.record(0, 'claude-sonnet-4-6', 1000, 500);
console.log(record.estimatedCost); // cost based on built-in pricing

// Get summary
const summary = tracker.getSummary();
console.log(summary.totalCost, summary.totalInputTokens, summary.totalOutputTokens);

// Check limits
const ok = await tracker.checkLimits(); // false if limit exceeded

// Standalone cost estimation
const cost = estimateCost('gpt-4o', 10000, 5000);
```

## Testing

`createMockModel()` returns a mock `LanguageModel` compatible with the Vercel AI SDK. It uses predetermined responses so you can test agent behavior without API keys.

```ts
import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import { tool } from 'ai';
import { z } from 'zod';

// Simulate a multi-step agent run: tool call -> final answer
const model = createMockModel({
  responses: [
    // Step 1: model calls a tool
    { toolCalls: [{ toolName: 'get_weather', args: { city: 'London' } }] },
    // Step 2: model responds with text (ends the loop)
    { text: 'The weather in London is rainy.' },
  ],
  modelId: 'test-model',
  inputTokensPerCall: 100,
  outputTokensPerCall: 50,
});

const agent = createAgent({
  id: 'test',
  name: 'Test',
  model,
  tools: {
    get_weather: tool({
      description: 'Get weather for a city',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => `${city}: rainy, 12C`,
    }),
  },
});

const result = await agent.run('Weather in London?');
// result === 'The weather in London is rainy.'
```

### MockModelOptions

| Option | Default | Description |
|--------|---------|-------------|
| `responses` | (required) | Array of `MockResponse` objects, used in order |
| `modelId` | `'mock-model'` | Model ID for logging |
| `provider` | `'mock-provider'` | Provider name for logging |
| `inputTokensPerCall` | `10` | Simulated input tokens per call |
| `outputTokensPerCall` | `20` | Simulated output tokens per call |

## API Reference

### Main exports (`@chaos/agent-loop`)

| Export | Type | Description |
|--------|------|-------------|
| `createAgent` | `(config: AgentConfig) => Agent` | Create an agent with `run()`, `stream()`, and `abort()` |
| `runAgentLoop` | `(config, task, context?) => Promise<RunResult>` | Run the loop directly (lower-level) |
| `streamAgentLoop` | `(config, task, context?) => AsyncGenerator<ProgressEvent>` | Stream the loop directly (lower-level) |
| `createFileTools` | `(store, agentId) => ToolSet` | Create file tools backed by a MemoryStore |
| `createSkillTools` | `(store: SkillStore) => ToolSet` | Create skill management tools |
| `buildSkillsPrompt` | `(skills: Skill[]) => string` | Build a system prompt section from skills |
| `parseSkillMd` | `(content, id?) => Skill` | Parse a SKILL.md with YAML frontmatter |
| `InMemorySkillStore` | class | In-memory reference implementation of SkillStore |
| `InMemoryMemoryStore` | class | In-memory store (testing/prototyping) |
| `FilesystemMemoryStore` | class | Node.js filesystem store (persistent) |
| `createOrchestrator` | `(config) => Orchestrator` | Create a multi-agent orchestrator |
| `evaluatePermission` | `(toolName, args, config) => Promise<boolean>` | Evaluate a permission check |
| `UsageTracker` | class | Track usage and costs within a run |
| `estimateCost` | `(model, input, output, pricing?) => number` | Estimate cost in USD |
| `DEFAULT_PRICING` | `PricingTable` | Built-in pricing for 50+ models |

### Test exports (`@chaos/agent-loop/testing`)

| Export | Type | Description |
|--------|------|-------------|
| `createMockModel` | `(options: MockModelOptions) => LanguageModel` | Create a mock model for testing |

### Key types

| Type | Description |
|------|-------------|
| `AgentConfig` | Full agent configuration (model, tools, hooks, permissions, usage) |
| `Agent` | Agent instance with `id`, `name`, `run()`, `stream()`, `abort()` |
| `ProgressEvent` | Event emitted during streaming |
| `RunResult` | Result of `run()` with text, usage, steps, aborted flag |
| `AgentHooks` | Lifecycle hook callbacks |
| `PermissionConfig` | Permission mode, per-tool overrides, callback |
| `Skill` / `SkillStore` | Skill definition and storage interface |
| `RunUsage` / `UsageRecord` | Usage summary and per-step records |
| `HookDecision` | Return value from hooks to control execution |
| `PricingTable` | Model pricing lookup (per 1M tokens) |
| `MemoryStore` | Storage interface for agent file operations |
| `FileEntry` | File/directory entry from `list()` |
| `ConversationMessage` | User/assistant message for conversation history |
| `Orchestrator` / `OrchestratorConfig` | Multi-agent orchestration types |

### Store exports (`@chaos/agent-loop/stores`)

| Export | Description |
|--------|-------------|
| `MemoryStore` | Storage interface (type) |
| `FileEntry` | File entry type |

### Store implementations

| Export | Import path | Description |
|--------|-------------|-------------|
| `InMemoryMemoryStore` | `@chaos/agent-loop` | In-memory store for testing/prototyping (data lost on exit) |
| `FilesystemMemoryStore` | `@chaos/agent-loop` | Node.js filesystem store (persistent, path-traversal safe) |

## Examples

The [`examples/`](examples/) directory contains runnable examples:

| # | File | Description |
|---|------|-------------|
| 1 | [`01-basic-agent.ts`](examples/01-basic-agent.ts) | Simplest possible agent |
| 2 | [`02-agent-with-tools.ts`](examples/02-agent-with-tools.ts) | Custom tools (weather, calculator) |
| 3 | [`03-agent-with-memory.ts`](examples/03-agent-with-memory.ts) | File tools with InMemoryMemoryStore |
| 4 | [`04-lifecycle-hooks.ts`](examples/04-lifecycle-hooks.ts) | Hooks for monitoring and control |
| 5 | [`05-multi-provider.ts`](examples/05-multi-provider.ts) | Anthropic, Google, OpenAI, Ollama |
| 6 | [`06-conversation-history.ts`](examples/06-conversation-history.ts) | Multi-turn conversations |
| 7 | [`07-multi-agent-orchestration.ts`](examples/07-multi-agent-orchestration.ts) | Master + worker agents |
| 8 | [`08-custom-memory-store.ts`](examples/08-custom-memory-store.ts) | Patterns for S3, Firestore, SQLite, filesystem |
| 9 | [`09-skills.ts`](examples/09-skills.ts) | Skills system |
| 10 | [`10-testing.ts`](examples/10-testing.ts) | Testing with createMockModel |
| 11 | [`11-filesystem-store.ts`](examples/11-filesystem-store.ts) | Persistent filesystem storage — explore the created files |

Run any example: `npx tsx examples/01-basic-agent.ts`

## License

Apache 2.0
