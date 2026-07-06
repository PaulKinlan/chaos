# Changelog — CHAOS relay server

All notable changes to the relay server are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

> Note: historically the version was auto-incremented on every commit (patch bump
> via `scripts/bump-version.mjs`, `[skip ci]`), so version numbers churned without
> meaning. Going forward, cut intentional releases and record them here. See
> `RELEASING.md`.

## [Unreleased]

### Added
- Outbound **attachments** on replies (Telegram `sendPhoto`/`sendDocument`,
  email via Resend), pass-through only, never stored in KV.
- `/health` now reports the real running version and deployment id.

### Fixed
- **Duplicate agent execution across shared-identity clients.** When several
  clients connected with the same key, each ran its own `kv.watch`, so every
  inbound message fired on every connection and the same command ran N times.
  Delivery is now claimed atomically per (user, message), so exactly one
  connection handles each message. Lets you run multiple instances on one key
  without duplicate runs (no more separate-profile workaround).
- WebSocket no longer re-pushes the last message on every reconnect.
- Message content is capped to fit the Deno KV 64KB value limit.
- `kv.ts` timer typed as `ReturnType<typeof setTimeout>` (was `number`), fixing
  `deno check`.

### Notes
- Data continues to live entirely in Deno KV (no external stores).

<!-- Template for the next release:
## [X.Y.Z] - YYYY-MM-DD
### Added / Changed / Fixed / Removed / Security
-->
