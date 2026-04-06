# CHAOS Development Guidelines

## Monorepo Structure

This is an npm workspaces monorepo. The extension code lives in `packages/extension/`.

```
chaos/
  packages/
    extension/   — Chrome extension (src/, manifest.json, vite.config.ts)
    shared/      — Shared utilities
    server/      — Server components
    web/         — Web frontend
  docs/          — Documentation
  plans/         — Implementation plans
```

## Before pushing changes

From root or `packages/extension/`:
1. Run `npx tsc --noEmit` - TypeScript must compile clean
2. Run `npx vite build` - build must succeed
3. Run `npx vitest run` - all tests must pass
4. Grep for patterns you just fixed across the entire codebase (e.g. if you fix `__dirname`, check all files)

Or from root using workspace commands:
- `npm run build` — builds the extension
- `npm test` — runs extension tests
- `npm run dev` — starts extension dev server

## After making changes (MANDATORY)

**You MUST update docs for every significant change.** This is not optional.

1. **`docs/prd.md`**: Update when adding features, changing user-facing behavior, or modifying the product model. Add new features to the feature list. Update UI descriptions. Document new tool categories.
2. **`docs/architecture.md`**: Update when changing technical architecture, adding new modules, changing data flow, adding new storage, or modifying the agent loop. Keep the architecture diagram current.
3. **`plans/`**: If the change relates to an active plan, update that plan to reflect what was implemented vs what's still pending.
4. **`README.md`**: Update the feature list when major features land.

If you're making 3+ related changes in a batch, update docs BEFORE committing the code changes.

## Relay server changes (MANDATORY)

When modifying `packages/server/`:

1. **Run `deno fmt packages/server/src/`** — format all server code
2. **Run `deno check packages/server/src/main.ts`** — type-check must pass
3. **Run conformance tests** — start the server locally, then run:
   ```
   cd packages/server && RELAY_URL=http://localhost:8787 deno task test:conformance
   ```
   All 38+ tests must pass. If your change breaks a test, fix the server OR update the test (and document why).
4. **Update `docs/relay-openapi.yaml`** if you:
   - Add, remove, or rename an endpoint
   - Change request/response schemas
   - Modify authentication requirements
   - Change rate limits
   - Add new channel types
5. **Update conformance tests** (`packages/server/tests/conformance/`) if you:
   - Add new endpoints (add test coverage)
   - Change existing endpoint behaviour (update assertions)
   - Modify auth flow
   - Change the WebSocket protocol
6. **Update `docs/api.md`** for any endpoint changes

The relay server is a public protocol. Third-party clients and servers depend on it being stable and well-documented. Every change must keep the spec, tests, and implementation in sync.

## Data store migrations (CRITICAL)

**NEVER change stored data formats without a migration path.** Users have agents, conversations, settings, and scheduled tasks that must survive extension updates.

Rules:
- **IndexedDB version bumps**: Always handle ALL previous versions in the upgrade function. Never delete or recreate stores that contain user data.
- **Chrome storage schema changes**: New optional fields are safe. Changing or removing existing fields requires reading old data, transforming it, and writing it back.
- **AgentMeta changes**: Only ADD optional fields. Never remove or rename existing fields. The getAgentList() function must handle agents with missing new fields gracefully.
- **ConversationMessage changes**: Only ADD optional fields. Old conversations must still render correctly.
- **Type changes**: If a type changes shape, the storage layer must handle both old and new shapes.
- **Test migrations**: Test that loading old data (without new fields) still works before pushing.

When in doubt:
- Make new fields optional (with `?`)
- Add defaults in the read function, not the write function
- Never overwrite user data on extension update
- Log warnings for migration issues, don't throw errors

## Code style

- TypeScript strict mode
- ESM modules (use `node:` prefix for Node built-ins)
- Use `import.meta.url` instead of `__dirname`
- Chrome permissions should be optional where possible
- All Chrome API tools should check permissions before use
- Use inline SVG icons, never emoji, for UI elements

## Contributor setup

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, setup steps, how to run tests, build, and submit PRs. Point new contributors there rather than duplicating instructions.
