# Plan: Agent Loop Library (`@chaos/agent-loop`)

## Status (audited 2026-04-11)

### Phase 1: Core Loop — DONE
- [x] `packages/agent-loop/` package created (`@chaos/agent-loop` v0.1.38)
- [x] `src/loop.ts` — core autonomous loop extracted
- [x] `src/agent.ts` — agent creation
- [x] `src/types.ts` — public types
- [x] `src/index.ts` — barrel export
- [x] Tests: `tests/loop.test.ts`

### Phase 2: File Tools + Storage — DONE
- [x] `src/tools/file-tools.ts` — file tools backed by MemoryStore
- [x] Tests: `tests/file-tools.test.ts`

### Phase 3: Skills — DONE
- [x] `src/skills.ts` — skill loading and prompt injection
- [x] Tests: `tests/skills.test.ts`

### Phase 4: Lifecycle Hooks + Permissions — DONE
- [x] `src/permissions.ts` — permission pipeline
- [x] Tests: `tests/hooks.test.ts`, `tests/permissions.test.ts`

### Phase 5: Usage Tracking + Limits — DONE
- [x] `src/usage.ts` — token tracking and cost estimation
- [x] Tests: `tests/usage.test.ts`

### Phase 6: Multi-Agent Orchestration — DONE
- [x] `createOrchestrator()` with master + worker agents
- [x] Delegation tools (`delegate_task`, `list_agents`, `get_agent_status`)
- [x] Pluggable messaging interface (with in-memory fallback)
- [x] Tests: `tests/orchestrator.test.ts`

### Phase 7: Migrate Extension — DONE
- [x] Extension imports `createAgent` and types from `@chaos/agent-loop`
- [x] Chrome-specific tools passed as custom tools
- [x] Verified in `packages/extension/src/agents/extension-agent.ts`

### Phase 8: Tests + Documentation — PARTIAL
- [x] Test suite for core modules (loop, file-tools, skills, hooks, permissions, usage)
- [x] Testing utilities (`src/testing/index.ts`)
- [x] README.md, docs/, llms.txt
- [ ] Examples: CLI agent, web agent, serverless agent
- [ ] Quickstart guides per runtime

---

## Problem

CHAOS has two agent loops (`loop.ts` and `agentic-loop.ts`) tightly coupled to the Chrome extension — they directly reference OPFS, chrome.storage, the extension's tool system, and the provider registry. This makes them impossible to use outside the extension.

The Anthropic Agent SDK provides a similar capability (autonomous tool-calling loop) but is Anthropic-only. CHAOS's loops are provider-agnostic (via Vercel AI SDK) and have unique features (dynamic skills, spending limits, browser tools, persistent multi-agent) that the Agent SDK doesn't have.

Extracting the loop into a standalone library would let anyone build an autonomous agent in any JavaScript runtime — browser, Node.js, Deno, Bun, Cloudflare Workers — with any LLM provider.

## Goals

1. Standalone `@chaos/agent-loop` package built on Vercel AI SDK
2. Provider-agnostic — works with any provider Vercel AI SDK supports
3. Runtime-agnostic — browser, Node.js, Deno, edge
4. Supports: skills, CLAUDE.md/AGENTS.md, tool calling, usage tracking, lifecycle hooks, permissions, multi-step autonomous execution
5. Pluggable storage for agent memory (uses `@chaos/sdk` store interfaces)
6. The CHAOS extension becomes a consumer of this library

## Comparison with Anthropic Agent SDK

| Feature | Anthropic Agent SDK | @chaos/agent-loop |
|---------|-------------------|-------------------|
| LLM support | Anthropic only | Any (via Vercel AI SDK) |
| Loop control | Opaque (`query()` stream) | Configurable (max iterations, abort, pause) |
| Tools | Built-in Claude Code tools | BYO tools (Vercel AI SDK `tool()`) + built-in file tools |
| Skills | Static filesystem SKILL.md | Dynamic runtime install from registry |
| Permissions | 5-layer evaluation funnel | Pluggable permission handler |
| Lifecycle hooks | 18 hook types (Pre/PostToolUse, Stop, etc.) | Similar hook system + spending/usage hooks |
| Multi-agent | Ephemeral subagents | Persistent agents with message passing |
| Storage | Filesystem only | Pluggable (OPFS, filesystem, S3, etc.) |
| System prompt | CLAUDE.md + AGENTS.md | CLAUDE.md + skills + injected context |
| Runtime | Node.js/Python | Any JS runtime |

## Architecture

```
@chaos/agent-loop
├── src/
│   ├── index.ts              — Main export: createAgent, runLoop
│   ├── types.ts              — All public types
│   ├── loop.ts               — Core autonomous loop
│   ├── prompt-builder.ts     — System prompt assembly (CLAUDE.md + skills + context)
│   ├── tools/
│   │   ├── index.ts          — Tool registry and filtering
│   │   ├── file-tools.ts     — read/write/edit/list/grep/find (uses MemoryStore)
│   │   └── builtin.ts        — Built-in utility tools
│   ├── skills/
│   │   ├── index.ts          — Skill loading and prompt injection
│   │   ├── parser.ts         — SKILL.md frontmatter parser
│   │   └── registry.ts       — Skill search and install
│   ├── hooks/
│   │   ├── index.ts          — Hook system (pre/post tool use, lifecycle)
│   │   └── types.ts          — Hook event types and decisions
│   ├── permissions/
│   │   ├── index.ts          — Permission evaluation pipeline
│   │   └── types.ts          — Permission levels and handlers
│   ├── usage/
│   │   ├── index.ts          — Token tracking per step
│   │   ├── pricing.ts        — Cost estimation
│   │   └── limits.ts         — Spending limit enforcement
│   └── activity/
│       └── index.ts          — Activity logging (pluggable sink)
├── tests/
│   ├── loop.test.ts          — Core loop tests with mock LLM
│   ├── tools.test.ts         — Tool registration and filtering
│   ├── skills.test.ts        — Skill loading and prompt injection
│   ├── hooks.test.ts         — Hook lifecycle and decisions
│   ├── permissions.test.ts   — Permission pipeline
│   └── usage.test.ts         — Usage tracking and limits
└── package.json
```

## Core API

### Creating and Running an Agent

```typescript
import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';
import { OPFSMemoryStore } from '@chaos/sdk/stores/opfs';

const agent = createAgent({
  // Identity
  id: 'agent-1',
  name: 'Research Assistant',

  // LLM provider (any Vercel AI SDK provider)
  model: createAnthropic({ apiKey: '...' })('claude-sonnet-4-6'),

  // System prompt sources
  claudeMd: '# Research Assistant\nYou help with research...',
  skills: [
    { name: 'web-research', content: '## Web Research\nWhen researching...' },
  ],

  // Storage for agent memory (pluggable)
  memory: new OPFSMemoryStore(),

  // Tools (Vercel AI SDK tool definitions)
  tools: {
    web_search: tool({ ... }),
    fetch_page: tool({ ... }),
  },

  // Options
  maxIterations: 20,
  innerStepLimit: 5,
});

// Run a task
const result = await agent.run('Research the latest trends in browser AI');

// Stream progress
for await (const event of agent.stream('Summarize this article')) {
  switch (event.type) {
    case 'thinking': console.log(event.content); break;
    case 'tool-call': console.log(`Calling ${event.toolName}`); break;
    case 'tool-result': console.log(`Result: ${event.result}`); break;
    case 'step-complete': console.log(`Step ${event.step} done`); break;
    case 'done': console.log('Final:', event.content); break;
    case 'error': console.error(event.content); break;
  }
}
```

### Tool System

```typescript
import { createAgent, fileTools } from '@chaos/agent-loop';

const agent = createAgent({
  // ...
  tools: {
    // Built-in file tools (backed by MemoryStore)
    ...fileTools(memoryStore, 'agent-1'),

    // Custom tools (standard Vercel AI SDK tool())
    web_search: tool({
      description: 'Search the web',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => { ... },
    }),
  },

  // Tool filtering
  enabledTools: ['read_file', 'write_file', 'web_search'], // whitelist (optional)
  disabledTools: ['delete_file'],                           // blacklist (optional)
});
```

### Skills

```typescript
import { createAgent, loadSkillsFromDirectory, searchSkills } from '@chaos/agent-loop';

// Load skills from filesystem
const skills = await loadSkillsFromDirectory('./skills/');

// Or search a registry
const results = await searchSkills('web scraping');

const agent = createAgent({
  // ...
  skills,

  // Enable runtime skill installation (agent can search + install skills mid-task)
  skillRegistry: {
    search: async (query) => searchSkills(query),
    install: async (url) => fetchAndParseSkill(url),
  },
});
```

### Lifecycle Hooks

Inspired by the Anthropic Agent SDK but adapted for the web platform:

```typescript
const agent = createAgent({
  // ...
  hooks: {
    // Before a tool is called — can modify input, deny, or inject context
    onPreToolUse: async (event) => {
      // event: { toolName, args, agentId, iteration }
      if (event.toolName === 'write_file' && event.args.path.includes('.env')) {
        return { decision: 'deny', reason: 'Cannot write to .env files' };
      }
      if (event.toolName === 'delete_file') {
        return { decision: 'ask' }; // delegate to permission handler
      }
      return { decision: 'allow' };
    },

    // After a tool completes — can inspect results, inject messages
    onPostToolUse: async (event) => {
      // event: { toolName, args, result, agentId, iteration, durationMs }
      console.log(`${event.toolName} completed in ${event.durationMs}ms`);
    },

    // Before each iteration of the outer loop
    onStepStart: async (event) => {
      // event: { step, totalSteps, agentId, tokensSoFar }
      if (event.tokensSoFar > 100000) {
        return { decision: 'stop', reason: 'Token budget exceeded' };
      }
      return { decision: 'continue' };
    },

    // After each iteration
    onStepComplete: async (event) => {
      // event: { step, hasToolCalls, text, agentId }
    },

    // When the loop finishes (success or error)
    onComplete: async (event) => {
      // event: { agentId, result, totalSteps, usage }
    },

    // When usage is recorded
    onUsage: async (event) => {
      // event: { inputTokens, outputTokens, estimatedCost, model }
    },
  },
});
```

### Permissions

```typescript
const agent = createAgent({
  // ...
  permissions: {
    // Default permission level for tools not explicitly configured
    defaultLevel: 'ask', // 'always' | 'ask' | 'never'

    // Per-tool overrides
    tools: {
      read_file: 'always',
      write_file: 'ask',
      delete_file: 'never',
      web_search: 'always',
    },

    // Handler called when permission is 'ask'
    onPermissionRequest: async (request) => {
      // request: { toolName, args, agentId, reason }
      // In a browser: show a dialog
      // In a CLI: prompt the user
      // In a server: check an allowlist
      return true; // or false
    },
  },
});
```

### Usage Tracking

```typescript
const agent = createAgent({
  // ...
  usage: {
    // Track token usage per step
    enabled: true,

    // Spending limits
    limits: {
      perRun: 1.00,      // max $1 per run
      perDay: 10.00,     // max $10 per day (checks across runs)
      perMonth: 100.00,  // max $100 per month
    },

    // Pricing table (or use built-in defaults)
    pricing: {
      'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    },

    // Callback when usage is recorded
    onUsage: async (record) => {
      await myDatabase.insert(record);
    },

    // Callback when a limit is hit
    onLimitExceeded: async (event) => {
      // event: { type: 'perRun'|'perDay'|'perMonth', spent, limit }
      console.warn(`Spending limit exceeded: ${event.type}`);
      // Return true to continue anyway, false to stop
      return false;
    },
  },
});
```

### Activity Logging

```typescript
const agent = createAgent({
  // ...
  activity: {
    // Log each interaction to a pluggable sink
    log: async (entry) => {
      // entry: { timestamp, role, summary, toolCalls?, agentId }
      await memoryStore.append(agentId, 'activity-log.jsonl', JSON.stringify(entry) + '\n');
    },
  },
});
```

### Multi-Agent (Delegation)

```typescript
import { createAgent, createOrchestrator } from '@chaos/agent-loop';

const researcher = createAgent({ id: 'researcher', name: 'Researcher', ... });
const writer = createAgent({ id: 'writer', name: 'Writer', ... });

const orchestrator = createOrchestrator({
  master: createAgent({
    id: 'master',
    name: 'Master',
    model: anthropic('claude-sonnet-4-6'),
    // Master gets delegation tools automatically
  }),
  agents: [researcher, writer],

  // How agents communicate
  messaging: {
    send: async (from, to, message) => { ... },
    receive: async (agentId) => { ... },
  },
});

const result = await orchestrator.run('Research and write an article about browser AI');
```

## Implementation Phases

### Phase 1: Core Loop

1. Create `packages/agent-loop/` package
2. Extract the loop logic from `agentic-loop.ts` into `loop.ts`
3. Remove all Chrome/OPFS/extension dependencies
4. Accept a Vercel AI SDK `LanguageModel` and `ToolSet`
5. `createAgent()` returns an agent with `run()` and `stream()` methods
6. Tests with a mock LLM
7. **Deliverable**: `await agent.run('task')` works with any provider

### Phase 2: File Tools + Storage

1. `fileTools(store, agentId)` returns read/write/edit/list/grep/find tools backed by any `MemoryStore`
2. System prompt builder reads CLAUDE.md from the store
3. Activity log writes to the store
4. **Deliverable**: agent has persistent memory via pluggable storage

### Phase 3: Skills

1. Skill parser (SKILL.md frontmatter + content)
2. Skill loader (from directory, from URL, from registry)
3. Skill prompt injection (into system prompt)
4. Runtime skill install tools (search_skills, install_skill)
5. **Deliverable**: agent can load and dynamically install skills

### Phase 4: Lifecycle Hooks + Permissions

1. Hook system (onPreToolUse, onPostToolUse, onStepStart, onStepComplete, onComplete)
2. Permission pipeline (default level → per-tool overrides → onPermissionRequest callback)
3. Hook decisions (allow/deny/ask, input modification, message injection)
4. **Deliverable**: full control over agent behavior at every step

### Phase 5: Usage Tracking + Limits

1. Per-step token tracking from Vercel AI SDK usage data
2. Cost estimation with pluggable pricing table
3. Spending limits (per-run, per-day, per-month) with configurable enforcement
4. Usage callbacks for external storage
5. **Deliverable**: cost-aware agent execution

### Phase 6: Multi-Agent Orchestration

1. `createOrchestrator()` with master + worker agents
2. Delegation tools (assign_task, find_agent, get_status)
3. Pluggable messaging interface
4. Agent discovery
5. **Deliverable**: multi-agent task delegation

### Phase 7: Migrate Extension

1. `packages/extension` adds `@chaos/agent-loop` as dependency
2. Replace `agentic-loop.ts` and `loop.ts` with library calls
3. Chrome-specific tools (tabs, bookmarks, etc.) passed as custom tools
4. Browser event hooks passed as lifecycle hooks
5. **Deliverable**: extension uses the library, all tests pass

### Phase 8: Tests + Documentation

1. Comprehensive test suite for every module
2. Mock LLM helper for testing agents without real API calls
3. README with quickstart for each runtime
4. Examples: CLI agent, web agent, serverless agent
5. **Deliverable**: publishable package

## Key Design Decisions

### Built on Vercel AI SDK, not replacing it

The library uses `streamText()` and `tool()` from the AI SDK. It doesn't wrap or hide them — it orchestrates them into an autonomous loop. Users can pass any `LanguageModel` from any AI SDK provider.

### CLAUDE.md, not AGENTS.md

The system prompt is assembled from:
1. A `claudeMd` string (the agent's personality/instructions)
2. Installed skills (injected as prompt sections)
3. Page/task context (injected per-run)
4. Activity log context (last N entries)

This matches CHAOS's current pattern. AGENTS.md support can be added later as an alternative format.

### Streaming-first

`agent.stream()` returns an `AsyncIterable<ProgressEvent>`. `agent.run()` is sugar that consumes the iterable and returns the final text. This matches the Vercel AI SDK's streaming-first philosophy.

### No opinion on storage

The library doesn't know about OPFS, filesystem, or any specific storage. It accepts a `MemoryStore` interface for file tools and activity logging. The consumer provides the implementation.

## Open Questions

1. **Should the orchestrator run agents in parallel?** The Anthropic Agent SDK runs subagents sequentially. CHAOS runs them in parallel via message passing. Both have tradeoffs.

2. **How to handle conversation history across runs?** The library manages history within a single `run()` call. Persisting across runs requires the consumer to store and replay messages.

3. **Should there be a built-in web search tool?** CHAOS has one (Brave API). The Agent SDK has one. Could offer a pluggable interface with a default implementation.

4. **Tool result size limits?** Large tool results (full web pages) can blow up context. Should the library auto-truncate, or leave it to the tool implementation?

5. **MCP server support?** The Agent SDK supports MCP servers as tool providers. Should this library too? Could be added as a tool source adapter.
