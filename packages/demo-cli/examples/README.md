# @chaos/agent-loop Examples

Runnable examples demonstrating the `@chaos/agent-loop` API. By default, all examples use mock models (no API keys needed).

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

## Using a real LLM

By default, examples use a mock model. To use a real provider:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/basic-agent.ts --provider anthropic
GOOGLE_API_KEY=AI... npx tsx examples/basic-agent.ts --provider google
OPENAI_API_KEY=sk-... npx tsx examples/basic-agent.ts --provider openai
```

Optionally specify a model:

```bash
npx tsx examples/basic-agent.ts --provider anthropic --model=claude-haiku-4-5
```

Supported providers and their defaults:

| Provider | Default model | Env variable |
|----------|---------------|--------------|
| `anthropic` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| `google` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` |

## Prerequisites

Install dependencies from the monorepo root:

```bash
npm install   # or pnpm install
```
