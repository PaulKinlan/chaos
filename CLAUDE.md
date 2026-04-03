# CHAOS Development Guidelines

## Before pushing changes

1. Run `npx tsc --noEmit` - TypeScript must compile clean
2. Run `npx vite build` - build must succeed
3. Run `npx vitest run` - all tests must pass
4. Grep for patterns you just fixed across the entire codebase (e.g. if you fix `__dirname`, check all files)

## After making changes

1. Keep `docs/prd.md` and `docs/architecture.md` up to date with any changes to features, architecture, or design decisions
2. If a new feature is added, update the relevant sections in both docs
3. If a design decision changes, update the docs to reflect the new approach

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
