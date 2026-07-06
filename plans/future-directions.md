# Plan: Future directions for the CHAOS relay

## Status
Idea backlog, seeded 2026-07-06 from Paul's direction. Not prioritised for build.

Framing: the relay bridges external channels (Telegram/Discord/email/webhook) to
an agent, with a per-user ECDSA identity and a channels + per-channel-hooks model.
Two near-term themes are already captured: `self-host-and-release.md` and
`user-admin-interface.md`. These are the ideas beyond those.

## Channels (more ways in and out)
- **More inbound channels:** Slack, WhatsApp / SMS (Twilio), Matrix, and a plain
  inbound RSS/Atom poll (turn a feed into agent nudges). Each reuses the existing
  channel + reply plumbing.
- **Outbound webhook channel:** deliver an agent's reply to an arbitrary external
  URL (the mirror of inbound webhooks), so the relay can drive other systems.
- **Attachments both ways:** inbound attachments (images/files a user sends) now
  that outbound attachments exist.

## Hooks (what happens per channel)
- **Formalise the hook model** (prereq for the admin UI): a channel has ordered
  hooks with a type (filter, transform, route, schedule) and config, stored in KV.
- **Filters and routing:** only forward messages matching a rule; route different
  messages from one channel to different agents.
- **Scheduled hooks:** cron-style triggers that poke the agent (a daily standup
  prompt, a reminder), not just reactive inbound.
- **Templated auto-replies:** an "away" or acknowledgement message while the agent
  works, beyond the existing typing indicator.

## Reliability and trust
- **Outbound delivery guarantees:** retry with backoff and a dead-letter record
  when a channel send fails (Telegram/Resend hiccups), surfaced in the admin UI.
- **Per-user rate limiting / abuse controls** on inbound and outbound.
- **Delivery + audit log per user** (ties directly to the admin UI): a searchable
  history of what came in and what was sent, all in KV.

## Identity and sharing
- **Shared channels:** more than one key mapped to a channel (a small team sharing
  one agent), without introducing public accounts, keeping the ECDSA model.
- **Key rotation / revocation** flow for a user's ECDSA identity.

## Ecosystem
- **Conformance suite as a public artifact:** `tests/conformance/` already exists;
  publish it so third-party relays/clients can self-certify.
- **Hosted status page** for the default relay's health.

## Suggested first slice
Formalise the hook model (unblocks the admin UI), then ship the admin UI, then
outbound delivery guarantees + the per-user audit log (the things early users will
feel first). New channel types are high-visibility but additive; do them once the
core management surface is solid.
