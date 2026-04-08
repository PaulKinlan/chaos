# CHAOS Relay Server

The CHAOS relay server is a Deno Deploy service that bridges external communication channels (Telegram, Discord, email, webhooks) to the CHAOS Chrome extension. It receives messages from external services, stores them temporarily, and delivers them to connected extension clients via WebSocket or HTTP polling.

## Running Locally

```bash
deno task dev     # Start with --watch for auto-reload (port 8787)
deno task start   # Start without watch
```

## Deploying

The server is designed to run on [Deno Deploy](https://deno.com/deploy). Deploy directly from the repository or use `deployctl`:

```bash
deployctl deploy --project=your-project src/main.ts
```

Deno Deploy provides managed Deno KV and automatic scaling across isolates.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CHAOS_ADMIN_KEY` | Yes | Password for the admin dashboard |
| `RESEND_API_KEY` | For email | API key for Resend (email sending) |
| `RESEND_WEBHOOK_SECRET` | For email | Secret for verifying Resend inbound webhooks |
| `CHAOS_EMAIL_DOMAIN` | For email | Domain for inbound email addresses (e.g. `chaos.example.com`) |
| `PORT` | No | Server port (default: `8787`, ignored on Deno Deploy) |

## API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check. Returns server status, version, KV availability, WebSocket count, uptime. |
| `POST` | `/auth/register` | Register a new session. Optionally send an ECDSA public key for request signing. Returns `userId`, `apiKey`, and `serverPublicKey`. |
| `POST` | `/webhook/:channelId` | Inbound webhook ingestion. Auth via URL query token, not Bearer. |
| `GET` | `/responses/:channelId` | Poll for agent replies to a channel. Used by external services. |
| `POST` | `/telegram/:channelId` | Telegram Bot API webhook endpoint. |
| `POST` | `/discord/:channelId` | Discord bot webhook endpoint. |
| `GET` | `/email/verify` | Email verification link handler. |
| `POST` | `/email/inbound` | Inbound email webhook (from Resend). |
| `GET` | `/ws?token=<apiKey>` | WebSocket upgrade. Real-time message delivery. |

### Authenticated (Bearer token)

All endpoints below require `Authorization: Bearer <apiKey>` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/messages?since=<timestamp>` | Poll for new messages since a timestamp. |
| `POST` | `/reply` | Send a reply through a channel. Body: `{ channelId, content, channelType?, replyTo?, metadata? }` |
| `POST` | `/channels` | Register a new channel (generic). |
| `GET` | `/channels` | List all channels for the authenticated user. |
| `PATCH` | `/channels/:channelId` | Update channel metadata (name, prompt, allowedUsers, allowedSenders). |
| `DELETE` | `/channels/:channelId` | Delete a channel. |
| `POST` | `/channels/telegram/register` | Register a Telegram bot channel. Body: `{ botToken, agentId? }` |
| `POST` | `/channels/discord/register` | Register a Discord bot channel. Body: `{ botToken, agentId? }` |
| `POST` | `/channels/email/register` | Register an email channel. Body: `{ userEmail, channelName, agentId? }` |

### Admin (session cookie auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin` | Admin dashboard (HTML). Redirects to login if not authenticated. |
| `GET` | `/admin/login` | Login page. |
| `POST` | `/admin/login` | Authenticate with admin password. Sets `chaos_admin` cookie. |
| `POST` | `/admin/logout` | Clear admin session. |
| `GET` | `/admin/status` | JSON status: sessions, channels, recent messages, WebSocket connections. |
| `GET` | `/admin/sessions/:userId/messages` | Get messages for a specific session. |
| `DELETE` | `/admin/sessions/:userId` | Delete a session and all its channels. |

## Authentication

The server uses ECDSA request signing for client authentication:

1. The extension registers with `/auth/register`, optionally providing an ECDSA public key.
2. The server returns an `apiKey` and its own `serverPublicKey`.
3. Subsequent requests include `Authorization: Bearer <apiKey>` along with `X-Timestamp`, `X-Nonce`, and `X-Signature` headers for request signing.
4. Webhook endpoints use URL-based token authentication instead of Bearer tokens.

## Channel Types

| Type | Direction | Description |
|------|-----------|-------------|
| `webhook` | Inbound | Generic webhook receiver. External services POST JSON to `/webhook/:channelId`. |
| `telegram` | Bidirectional | Telegram bot integration. Server registers a webhook with the Telegram Bot API and relays messages both ways. Uses pairing codes for user verification. |
| `discord` | Bidirectional | Discord bot integration. Similar to Telegram -- registers a webhook and relays messages. Uses pairing codes for user verification. |
| `email` | Bidirectional | Email channel via Resend. Generates an inbound email address, requires email verification, supports sender allowlists. |
| `slack` | Bidirectional | Slack integration (type defined in shared types). |

## WebSocket Protocol

Connect to `/ws?token=<apiKey>` for real-time message delivery.

**Server to client:**
- `{ type: "message", message: ChannelMessage }` -- new inbound message

**Client to server:**
- `{ type: "reply", channelId, content, channelType?, replyTo?, metadata? }` -- send a reply
- `{ type: "ping" }` -- keepalive (server responds with `{ type: "pong" }`)

**Server replies:**
- `{ type: "reply_ack", ... }` -- reply confirmation
- `{ type: "error", error: string }` -- error

On WebSocket connect, the server sends any missed messages from the last 5 minutes to cover reconnection gaps.

## Architecture

- **Runtime:** Deno with `Deno.serve()`
- **Persistence:** Deno KV for sessions, channels, messages, admin sessions, and server keypairs. Falls back to in-memory storage when KV is unavailable (e.g. tests).
- **Cross-isolate delivery:** Uses `kv.watch()` to detect new messages across Deno Deploy isolates and push them via WebSocket.
- **Rate limiting:** Per-endpoint rate limits (registration: 5/hr, webhooks: 60/min, message polling: 120/min, replies: 30/min, channel registration: 10/hr).
- **Message sanitization:** All inbound and outbound message content is sanitized.
- **Token encryption:** Bot tokens (Telegram, Discord) are encrypted at rest in KV.
- **Message cleanup:** Automatic periodic cleanup of old messages.

### Source Files

| File | Description |
|------|-------------|
| `src/main.ts` | HTTP server, routing, WebSocket handling, admin dashboard |
| `src/auth.ts` | Session management, ECDSA auth validation, channel CRUD |
| `src/kv.ts` | Deno KV persistence layer with typed helpers |
| `src/store.ts` | Message storage and retrieval |
| `src/crypto.ts` | Server keypair management, token encryption |
| `src/ws.ts` | WebSocket connection tracking |
| `src/rate-limit.ts` | Rate limiter implementation |
| `src/sanitize.ts` | Message content sanitization |
| `src/logger.ts` | Structured logging |
| `src/channels/webhook.ts` | Generic webhook channel handler |
| `src/channels/telegram.ts` | Telegram bot integration |
| `src/channels/discord.ts` | Discord bot integration |
| `src/channels/email.ts` | Email channel (Resend) integration |
| `src/channels/responder.ts` | Outbound reply routing |

## Testing

```bash
deno task test                # Unit tests
deno task test:conformance    # Conformance tests (requires running server)

# Run conformance tests against a local server:
RELAY_URL=http://localhost:8787 deno task test:conformance
```

## License

Apache 2.0
