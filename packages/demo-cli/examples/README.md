# @chaos/agent-loop Examples

Runnable examples demonstrating the `@chaos/agent-loop` API. All examples use mock models (no API keys needed).

## Examples

| File | Description |
|------|-------------|
| `basic-agent.ts` | Simplest possible agent -- create, run, print result |
| `streaming.ts` | Stream a task and print each event as it arrives |
| `custom-tools.ts` | Define custom tools with Zod schemas (calculator, weather) |
| `hooks-demo.ts` | Lifecycle hooks: pre/post tool use, step start, completion |
| `permissions-demo.ts` | Permission modes: accept-all, deny-all, ask with callbacks |
| `skills-demo.ts` | Skill store: install skills, inject into system prompt |
| `usage-tracking.ts` | Track tokens, cost, and per-step usage with spending limits |
| `multi-step.ts` | Multi-step autonomous agent that loops through tool calls |
| `abort-demo.ts` | Abort a long-running agent with AbortSignal |

## Running

From the `packages/demo-cli/` directory:

```bash
npx tsx examples/basic-agent.ts
npx tsx examples/streaming.ts
npx tsx examples/custom-tools.ts
npx tsx examples/hooks-demo.ts
npx tsx examples/permissions-demo.ts
npx tsx examples/skills-demo.ts
npx tsx examples/usage-tracking.ts
npx tsx examples/multi-step.ts
npx tsx examples/abort-demo.ts
```

## Prerequisites

Install dependencies from the monorepo root:

```bash
npm install   # or pnpm install
```
