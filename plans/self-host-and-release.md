# Plan: Self-hosting, Docker, and public release

## Status
Proposed 2026-07-06 (from Paul's direction). Not started.

## Motivation
The relay runs great on Deno Deploy, but Deno Deploy caps how long a WebSocket
can stay open (serverless isolates recycle). Paul wants a first-class option to
run the same server on a long-lived host (a Hetzner/VPS box, Cloud Run, a
container) where WS connections persist, while keeping the Deno Deploy path.
This is now a public project, so packaging and release discipline matter.

## What already exists (don't rebuild)
- `docs/relay-self-hosting.md` — env vars (`PORT`, `CHAOS_ADMIN_KEY`,
  `CHAOS_ENCRYPTION_KEY`, `CHAOS_EMAIL_DOMAIN`, Resend keys), local run via
  `deno task start`, and it already mentions Docker as optional.
- `docs/setup-gcp.md` — GCP setup notes.
- `scripts/bump-version.mjs` — bumps versions across the workspace.
- `packages/server/src/version.ts` — `/health` reports the running version.
- Polling fallback already exists, so a dropped WS is not fatal; a long-lived
  host mostly removes the drops rather than being strictly required.

## Gaps / work
1. **KV persistence for containers (code).** `Deno.openKv()` is called with no
   path (`src/kv.ts`), so self-hosted it writes to Deno's default dir (ephemeral
   in a container). Add `Deno.openKv(Deno.env.get("CHAOS_KV_PATH") || undefined)`
   so a self-host can point KV at a mounted volume (e.g. `/data/kv.sqlite`), and
   add `--allow-write` to the `start` task. On Deno Deploy `CHAOS_KV_PATH` stays
   unset → managed KV, unchanged. **Data stays in Deno KV** (no R2/S3/external
   store — a hard constraint for this project). Single-instance self-host uses a
   local SQLite KV; multi-instance would need a shared KV and is out of scope for
   v1 (document the limitation).
2. **Dockerfile** (`packages/server/Dockerfile`) on the official `denoland/deno`
   image: cache deps, run `src/main.ts` with the start flags, `EXPOSE 8787`,
   default `CHAOS_KV_PATH=/data/kv.sqlite`. Plus a `docker-compose.yml` with a
   named volume for `/data` so KV survives restarts.
3. **Cloud Run + VPS guide** in `docs/relay-self-hosting.md`: a Cloud Run deploy
   (note: Cloud Run's container filesystem is ephemeral, so KV persistence there
   needs a mounted volume / GCS-FUSE, or accept ephemerality — call this out),
   and a Hetzner/VPS recipe with a `systemd` unit + a TLS reverse proxy (Caddy)
   since Telegram/Discord webhooks require HTTPS.
4. **Public release + versioning discipline.** Server is `@chaos/server`,
   `private: true`. Decide distribution (see Open questions). Regardless:
   - Add `CHANGELOG.md` (Keep a Changelog format) and a `RELEASING.md` checklist.
   - Every publish MUST run `scripts/bump-version.mjs <level>` and add a
     changelog entry; CI/pre-push should fail a publish where the version did not
     change. This is the fix for "I don't see the version numbers updating."

## Open questions (need Paul)
- **Server distribution:** it's a Deno app, so npm is not its native channel.
  Options, not exclusive: (a) **Docker image** as the primary "deploy anywhere"
  artifact (recommended); (b) `deno run -A jsr:@paulkinlan/chaos-relay` via JSR;
  (c) a thin **npm** wrapper (`npx chaos-relay-server`) that shells to Deno, to
  satisfy "make it an npm package." Which of these do you want as the headline
  install? (The `pi-chaos-relay` *client* is already public on npm at 0.14.0.)
- Cloud Run vs a persistent VPS as the recommended long-lived target?

## Sequence
1. CHANGELOG + RELEASING (zero risk, do first).
2. KV-path code change + `--allow-write` (small, tested: `deno fmt` + `deno check`
   + tests).
3. Dockerfile + docker-compose.
4. Cloud Run / VPS docs.
5. Chosen public-distribution artifact.

## Decisions (2026-07-06, Paul)
- **Ship all three distributions:** the Docker image (done), a **JSR module**
  (`deno run -A jsr:.../chaos-relay`), and a **thin npx wrapper** that shells to
  Deno so it is literally on npm.
- **Multi-instance sharing a KV is a goal.** The relay and the admin app may run
  as separate instances pointing at the **same Deno KV** (same `CHAOS_KV_PATH` /
  same store) and the **same `CHAOS_ENCRYPTION_KEY`** so they can read each
  other's encrypted data without cross-contamination. Document this as the
  supported multi-instance story (supersedes the earlier "out of scope for v1").

## Progress (2026-07-06)
- Done + validated: Docker image, `CHAOS_KV_PATH` persistence, Cloud Run/VPS
  docs, CHANGELOG + RELEASING, JSR config (Deno workspace; `deno publish
  --dry-run` passes), thin npx wrapper (`packages/relay-cli`, `chaos-relay-server`).
  Bump script now syncs `deno.json` versions.
- Left to Paul (publish-gated): create the `@paulkinlan` JSR scope and run
  `deno publish` for `@paulkinlan/chaos-shared` + `@paulkinlan/chaos-relay`;
  `npm publish` the wrapper; push the Docker image to a registry.
