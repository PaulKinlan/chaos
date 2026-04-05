# Contributing to CHAOS

Thanks for your interest in contributing to CHAOS - Chrome Agent OS.

## Prerequisites

- **Node.js 20+**
- **Deno 2.x** (for the server package)
- **Chrome** (for loading the extension)

## Setup

```bash
# Clone the repo
git clone https://github.com/AiChr/chaos.git
cd chaos

# Install dependencies (npm workspaces will handle all packages)
npm ci

# Start the extension dev server
npm run dev
```

Load the extension in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist/` directory

## Project structure

This is an npm workspaces monorepo:

```
chaos/
  packages/
    extension/   - Chrome extension (Vite + TypeScript)
    server/      - Relay server (Deno)
    shared/      - Shared types used by extension and server
    web/         - Web frontend
  docs/          - Documentation (architecture.md, prd.md)
  plans/         - Implementation plans
```

Most development happens in `packages/extension/`.

## Running tests

```bash
# Unit + integration tests (from root)
npm test

# From the extension package directly
cd packages/extension
npx vitest run

# Watch mode
npx vitest --exclude src/__tests__/e2e/

# E2E tests (requires a build first)
npm run build
npx vitest run src/__tests__/e2e/
```

Server tests (Deno):
```bash
cd packages/server
deno task test
```

## Building

```bash
# Build the extension (from root)
npm run build

# This runs: tsc && vite build && node scripts/validate-build.mjs
```

The built extension is output to `packages/extension/dist/`.

## Before submitting a PR

1. **TypeScript must compile clean**: `npx tsc --noEmit` (from `packages/extension/`)
2. **Build must succeed**: `npm run build`
3. **All tests must pass**: `npm test`
4. **Grep for patterns you changed** across the entire codebase to make sure nothing was missed
5. **Update docs** for any significant changes:
   - `docs/prd.md` for user-facing behavior changes
   - `docs/architecture.md` for technical architecture changes
   - Relevant `plans/` file if the change relates to an active plan
   - `README.md` if a major feature landed

## Code style

- TypeScript strict mode
- ESM modules (use `node:` prefix for Node built-ins)
- Use `import.meta.url` instead of `__dirname`
- Use inline SVG icons, never emoji, for UI elements
- Chrome permissions should be optional where possible
- All Chrome API tools should check permissions before use

See `CLAUDE.md` for the full development guidelines, including critical rules about data store migrations.

## Data store migrations

This is important: never change stored data formats without a migration path. Users have agents, conversations, settings, and scheduled tasks that must survive extension updates. See the "Data store migrations" section in `CLAUDE.md` for the full rules.

## PR guidelines

- Keep PRs focused on a single change
- Include a clear description of what and why
- Add tests for new functionality
- Use the PR template checklist
