# Releasing CHAOS

CHAOS is now a public project, so releases should be intentional and legible,
not silent patch churn. This applies to the relay server (`packages/server`) and
the published client (`pi-chaos-relay`, on npm).

## The problem this fixes
The server version was auto-incremented on every commit (`chore: bump version to
0.1.x [skip ci]`), so the number moved constantly but meant nothing and there was
no changelog. For a public project, prefer deliberate semver releases with notes.

## Release checklist (every publish)
1. **Decide the bump.** `patch` = fixes only, `minor` = new backwards-compatible
   features, `major` = breaking changes. (Client and server version
   independently.)
2. **Update the changelog.** Move `[Unreleased]` items into a new
   `## [X.Y.Z] - YYYY-MM-DD` section in the relevant `CHANGELOG.md`
   (`packages/server/CHANGELOG.md` for the server; add one for the client too).
   No changelog entry → not ready to release.
3. **Bump the version:** `node scripts/bump-version.mjs <patch|minor|X.Y.Z>`.
4. **Validate** (server): `deno fmt`, `deno check packages/server/src/main.ts`,
   `deno task --cwd packages/server test`. (Client): `npm test`, `tsc --noEmit`.
5. **Commit** the version bump + changelog together, tagged `vX.Y.Z`.
6. **Publish** (Paul does this): `npm publish` for the client; for the server,
   build/push the Docker image and/or the chosen distribution artifact (see
   `plans/self-host-and-release.md`).
7. **Verify** the deployed `/health` reports the new version.

## Guardrail
CI (or a pre-push hook) should refuse a publish where `CHANGELOG.md` was not
touched in the same change as a version bump, so a release always carries notes.
If we keep any auto-bump, restrict it to `patch` on `main` and still require a
changelog line, or drop it in favour of the deliberate flow above.

## Publishing the distributions (server)
The relay ships three ways; keep their versions in lockstep (the bump script now
syncs both `package.json` and `deno.json`, and `relay-cli/bin.mjs` reads its own
`package.json` so the JSR spec follows automatically).

1. **Docker image:** build from the repo root and push
   (`docker build -f packages/server/Dockerfile -t <registry>/chaos-relay .`).
2. **JSR module:** needs the `@paulkinlan` JSR scope. Publish the workspace
   members (shared first): `deno publish --allow-slow-types` from
   `packages/shared`, then `packages/server`. (`--allow-slow-types` because the
   server is an app entry, not a typed library API.) Validate first with
   `deno publish --dry-run --allow-slow-types`.
3. **npx wrapper:** `cd packages/relay-cli && npm publish` (package
   `chaos-relay-server`, runs `jsr:@paulkinlan/chaos-relay@<version>`).
