# @chaos/agent-loop — Development Guide

## What This Is

A standalone, provider-agnostic autonomous agent loop for JavaScript. Built on the Vercel AI SDK. Zero internal dependencies beyond `ai` and `zod`.

## Project Structure

```
src/
  agent.ts          — createAgent() — the main entry point
  loop.ts           — runAgentLoop / streamAgentLoop — core loop implementation
  types.ts          — all TypeScript interfaces and types
  stores.ts         — MemoryStore + FileEntry interfaces
  stores/
    in-memory.ts    — InMemoryMemoryStore (testing/prototyping)
    filesystem.ts   — FilesystemMemoryStore (Node.js persistent)
  tools/
    file-tools.ts   — createFileTools() — file tools backed by MemoryStore
  skills.ts         — skill system (parse, build prompt, InMemorySkillStore)
  permissions.ts    — permission evaluation logic
  usage.ts          — UsageTracker + cost estimation + DEFAULT_PRICING
  orchestrator.ts   — multi-agent orchestration (master + workers)
  testing/
    index.ts        — createMockModel() for testing
  index.ts          — all exports

tests/              — vitest unit tests (one file per module)
examples/           — 11 runnable examples (npx tsx examples/NN-name.ts)
```

## Rules for Every Change

1. **Tests first** — write or update tests for every change. Run `npm test` before committing.
2. **Examples** — if the change affects user-facing API, update the relevant example in `examples/`.
3. **README** — keep the README API reference table and examples table current.
4. **Types** — export all public types from `src/types.ts` and re-export from `src/index.ts`.
5. **No internal dependencies** — this package must NOT reference `@chaos/sdk`, `@chaos/extension`, or any other internal package. It is standalone.
6. **llms.txt** — update `llms.txt` if you add new exports or change the API surface.

## Running Tests

```bash
npm test                    # run all tests
npx vitest run --watch      # watch mode
npx vitest run tests/loop.test.ts  # single file
```

## Running Examples

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/01-basic-agent.ts
npx tsx examples/11-filesystem-store.ts
```

## Key Design Decisions

- **MemoryStore is agentId-scoped** — every method takes `agentId` as the first parameter. This allows one store instance to serve multiple agents.
- **The loop is a generator** — `streamAgentLoop` is an `AsyncGenerator<ProgressEvent>`. This is consumed by `agent.stream()` and by callers iterating with `for await`.
- **Hooks are optional async functions** — they can return `HookDecision` to allow/deny/stop/modify. All hooks are fire-and-forget safe (errors logged, not thrown).
- **The mock model uses a response queue** — `responses[0]` for the first LLM call, `responses[1]` for the second, etc. This makes tests deterministic.
- **Prompt caching is automatic** — `prepareStep` adds Anthropic cache control breakpoints. No configuration needed.
- **HTML generation order** — the system prompt instructs: DOM first, CSS second, JS third.

## What NOT to Do

- Do not add browser-specific code (no `chrome.*`, no DOM, no `window`)
- Do not import from `@chaos/sdk` or any other monorepo package
- Do not add heavy dependencies — keep the bundle small
- Do not use `eval()` or `Function()` in production code
- Do not modify the mock model to have side effects in tests
