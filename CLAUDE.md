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

## Code style

- TypeScript strict mode
- ESM modules (use `node:` prefix for Node built-ins)
- Use `import.meta.url` instead of `__dirname`
- Chrome permissions should be optional where possible
- All Chrome API tools should check permissions before use
