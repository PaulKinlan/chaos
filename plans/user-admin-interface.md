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
