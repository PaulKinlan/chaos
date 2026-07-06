# Plan: Per-user admin interface for channels & hooks

## Status
Proposed 2026-07-06 (from Paul's direction, + early-user feedback). Not started.

## Motivation
Setting up channels by talking to the LLM ("register a Telegram bot, token is
…") is a great demo and we keep it. But early users want a real UI to see and
manage their configuration: a user can have **multiple channels**, and **multiple
hooks per channel**, and there is currently no self-serve way to view or edit all
of that. We need this **without public accounts** — the identity model is already
per-user ECDSA (P-256) keypairs, so the admin surface should authenticate with
the key the user already has, not a new email/password login.

## What exists
- **Identity:** each user is an ECDSA P-256 keypair → `userId`; requests are
  signed (`X-Timestamp` / `X-Nonce` / `X-Signature`) and the server verifies
  them (`packages/server/src/crypto.ts`, `auth.ts`).
- **Global admin:** `/admin` (+ `/admin/status`) exists but is gated by a single
  `CHAOS_ADMIN_KEY` password and shows server-wide state — this is an operator
  tool, NOT the per-user surface we want.
- **Channel storage:** channels live in KV under the user's session
  (`addChannel`, `getChannels`, `getSessionByChannelId`). Webhook endpoints are
  `/webhook/{id}`.

## Proposed design
A web app served by the relay at e.g. `/app`, authenticated by the user's
existing keypair, exposing CRUD over their own channels and hooks only.

1. **Auth without accounts.** The user proves control of their key to start a
   short session. Options: (a) paste/import the key (as the CLI already stores
   it) and the browser signs a challenge; (b) a device-link flow where the CLI
   mints a short-lived, signed session token the browser redeems. Never send the
   private key to the server; sign a server-issued nonce client-side, exactly
   like the existing request signing. Result is a scoped session bound to
   `userId`.
2. **Channels view.** List the user's channels (Telegram / Discord / email /
   webhook), their status, and metadata (with secrets masked). Add / edit /
   remove a channel from the UI, reusing the same server handlers the LLM path
   calls (`/channels/telegram/register`, etc.) so there is one code path.
3. **Hooks per channel.** Surface the multiple-hooks-per-channel model: view,
   add, edit, remove hooks for a channel, with whatever per-hook config exists
   (filters, targets). This likely needs the hook model formalised in KV if it
   is currently implicit.
4. **Config overview.** A read-only "here is everything you have set up" page,
   useful for support and for users to sanity-check.
5. **Keep the LLM path.** The chat-driven setup stays as an equal alternative;
   both write the same KV shapes.

## Constraints
- Per-user isolation: a session can only see/mutate its own `userId`'s data.
- Data stays in Deno KV (project constraint).
- Reuse the existing signing/verification; do not invent a second auth system.
- Follow repo standards: `deno fmt` + `deno check`, comprehensive logging, SVG
  icons (not emoji), no in-memory stores.

## Open questions (need Paul)
- Auth UX: key-paste-and-sign in the browser, or a CLI-minted device-link token?
- Is the hook model already persisted per channel, or does it need formalising
  first? (Affects scope a lot.)
- Served from the relay itself (`/app`) or a separate static client that talks to
  the relay API?

## Relationship to existing plans
Overlaps `plans/reactive-ui.md`, `plans/onboarding-and-help.md`, and
`plans/smart-onboarding.md` (all extension-side UI). This is the first
**server-hosted, key-authed** user surface, so it is new, but should reuse the
component/design-system direction in `reactive-ui.md`.

## Decisions (2026-07-06, Paul)
- **No account management at all.** Auth is the CLI mints a short-lived
  **device-link token**, redeemed in the browser (chosen over browser key-paste).
- **Served by the relay at `/app`**, because that is where the Deno KV lives. The
  app and relay may be separate instances **sharing the same KV** (same store +
  same `CHAOS_ENCRYPTION_KEY`), so an `/app`-only deployment can talk to the same
  data as the relay.

## Finding: channels vs "hooks" (investigated 2026-07-06)
The data model **already supports multiples of every type.** `ChannelConfig` is
keyed by a unique `id` (not by type), and `addChannel` does
`session.channels.push(channel)` (`packages/server/src/auth.ts`), so a user can
have many Telegram bots, Discord bots, email addresses, and webhooks at once.
There is **no separate "hook" concept** in the code today — each bot/email/webhook
*is* a channel. So "sort out hooks" is most likely: (a) make the register flow +
admin UI cleanly add/list/manage multiple channels per type (a UX gap, not a data
gap), OR (b) if Paul wants a **grouping** (one logical channel with several
endpoints/hooks under it), that is a new model on top of the flat channel list.
**Needs one clarification from Paul before building.**

## Clarified (2026-07-06): it's (a), flat multiples — no grouping
Paul confirmed: he wants users to add/manage multiple webhooks, emails, and bots
under the **one account per ECDSA key** — the flat model that already exists. No
grouping/"logical channel" layer. So the admin UI is purely a management surface
over the existing `session.channels[]`.

The real driver behind the question was a bug (now fixed): running multiple
instances on one key duplicated inbound message execution, forcing separate
per-instance keys. Fixed via atomic per-message delivery claiming (see
`plans/single-delivery-multi-connection.md` / server CHANGELOG). With that fixed,
multiple instances can share one key safely, which is what makes the flat
multi-channel model usable in practice.

## Slice 1 shipped (2026-07-06)
Device-link auth (`POST /app/device-link` signed → one-time token; browser
redeems via `POST /app/api/session` for a 24h app-session bearer; no accounts),
served UI at `/app`, and channel management API (`GET /app/api/channels`,
`DELETE`/`PATCH /app/api/channels/:id`) scoped to the app-session's user, with
secrets masked (`maskChannel`, tested). UI lists channels grouped by type with
enable/disable + delete. CLI entry point: pi-chaos-relay `configure` mints the
link and prints it. Validated (fmt/check/36 tests + smoke). **Slice 2:** add
channels from the UI — needs the per-type registration logic (telegram/discord
webhook setup, email allocation) extracted so app-session endpoints can call it.

## Slice 2 shipped (2026-07-06)
Add channels from the UI. Extracted per-type registration into
`src/registration.ts` (`registerTelegram/Discord/Email/WebhookForUser`, wrapping
the existing platform helpers + encrypt + addChannel), and wired
`POST /app/api/channels` to dispatch by type under the app-session's user. UI got
an "Add a channel" form (type select + field + name). Returns pairing code /
webhook URL / inbound address as appropriate. Validated end-to-end with a new
conformance test (`tests/conformance/app_test.ts`: device-link → session → add
webhook → list masked → single-use → delete) and the existing channels
conformance still passes (14). **Follow-up (low priority):** dedupe the signed
`/channels/*/register` endpoints to call `registration.ts` too (kept as-is to
avoid touching live, mostly-untestable endpoints; registration logic is
duplicated but stable).
