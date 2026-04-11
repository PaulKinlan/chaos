# CHAOS Relay Server API Specification

This document is a human-readable reference for the CHAOS relay server API. For the machine-readable OpenAPI 3.1 specification, see [relay-openapi.yaml](relay-openapi.yaml).

## Base URL

- **Local development**: `http://localhost:8787`
- **Production (Deno Deploy)**: `https://chaos-relay.deno.dev`

## Authentication

The relay uses three authentication mechanisms depending on the endpoint:

### Bearer Token (most endpoints)

Obtained from `POST /auth/register`. Include in all authenticated requests:

```
Authorization: Bearer {apiKey}
```

### ECDSA Request Signing (optional, enhanced security)

When a session is registered with a `publicKey`, all subsequent requests must include signature headers:

| Header | Description |
|--------|-------------|
| `Authorization` | `Bearer {apiKey}` |
| `X-Timestamp` | ISO 8601 timestamp (must be within 5 minutes of server time) |
| `X-Nonce` | Random 16-byte hex string (unique per request) |
| `X-Signature` | Base64-encoded ECDSA-SHA256 signature |

Signature is computed over the payload: `{timestamp}\n{nonce}\n{path}\n{bodyHash}`

Where `bodyHash` is the SHA-256 hex digest of the request body (empty string for GET/HEAD requests).

### Webhook Token (inbound webhooks)

Webhook endpoints use a `token` query parameter instead of Bearer auth:

```
POST /webhook/{channelId}?token={webhookSecret}
```

### Admin Cookie (admin endpoints)

Admin endpoints use a session cookie `chaos_admin`, set by `POST /admin/login`.

## Rate Limits

All endpoints enforce per-key rate limits. Exceeding a limit returns `429 Too Many Requests`.

| Endpoint | Limit | Window | Keyed By |
|----------|-------|--------|----------|
| `POST /auth/register` | 5 | 1 hour | Client IP |
| `GET /messages` | 120 | 1 minute | User ID |
| `POST /reply` | 30 | 1 minute | User ID |
| `POST /webhook/:id` | 60 | 1 minute | Channel ID |
| `POST /telegram/:id` | 60 | 1 minute | Channel ID |
| `POST /discord/:id` | 60 | 1 minute | Channel ID |
| `POST /email/inbound` | 60 | 1 minute | Global |
| `POST /channels` | 10 | 1 hour | User ID |
| `POST /channels/*/register` | 10 | 1 hour | User ID |

## CORS

All origins are allowed (`Access-Control-Allow-Origin: *`). Preflight `OPTIONS` requests return `204`.

---

## Endpoints

### Public

#### `GET /health`

Health check. No authentication required.

**Response** `200`:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "kv": true,
  "websockets": 3,
  "uptime": 12345
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` |
| `version` | string | Server version |
| `kv` | boolean | Whether Deno KV is available |
| `websockets` | integer | Active WebSocket connections |
| `uptime` | integer | Seconds since server start |

#### `GET /responses/{channelId}?since={ISO8601}`

Poll for agent responses to a specific channel. No authentication required. Used by external services to retrieve agent replies.

**Response** `200`:
```json
{
  "responses": [
    {
      "id": "resp_abc",
      "userId": "usr_123",
      "channelType": "webhook",
      "channelId": "ch_123",
      "from": "agent",
      "content": "Agent's reply text",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ],
  "since": "2025-01-15T10:31:00Z"
}
```

Use the returned `since` value for the next poll.

---

### Auth

#### `POST /auth/register`

Register a new session. Returns credentials for all subsequent API calls.

**Request body** (optional):
```json
{
  "publicKey": {
    "kty": "EC",
    "crv": "P-256",
    "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
    "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"
  }
}
```

If `publicKey` is provided, all future requests must include signature headers. If a session with the same public key already exists, the existing session is reclaimed.

**Response** `200`:
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "apiKey": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "serverPublicKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
}
```

---

### Messages

#### `GET /messages?since={ISO8601}`

Poll for inbound messages. Requires Bearer auth.

Messages are stored for up to 24 hours with a maximum of 100 per user. Use the `since` parameter for efficient polling.

**Response** `200`:
```json
{
  "messages": [
    {
      "id": "msg_abc123",
      "channelType": "webhook",
      "channelId": "ch_def456",
      "from": "GitHub Actions",
      "content": "Build succeeded on main",
      "timestamp": "2025-01-15T10:30:00Z",
      "metadata": { "repo": "user/project" }
    }
  ],
  "since": "2025-01-15T10:31:00Z"
}
```

Use the returned `since` value for the next poll.

#### `POST /reply`

Send a reply to a channel message. Requires Bearer auth.

For Telegram channels, the server calls the Telegram Bot API `sendMessage`. For webhook channels, the response is stored for retrieval via `GET /responses/:channelId`. Content is sanitized server-side.

**Request body**:
```json
{
  "channelType": "telegram",
  "channelId": "ch_abc123",
  "replyTo": "msg_original",
  "content": "Here is the agent's response."
}
```

**Response** `200`:
```json
{
  "ok": true,
  "channelType": "telegram",
  "channelId": "ch_abc123"
}
```

---

### Channels

#### `GET /channels`

List all channels for the authenticated user. Requires Bearer auth.

**Response** `200`:
```json
{
  "channels": [
    {
      "id": "ch_abc123",
      "name": "Deploy Notifications",
      "type": "webhook",
      "direction": "inbound",
      "agentId": "agent-123-abc",
      "enabled": true,
      "metadata": { "webhookSecret": "secret-uuid" }
    }
  ]
}
```

#### `POST /channels`

Create a new channel. Requires Bearer auth.

**Request body**:
```json
{
  "type": "webhook",
  "agentId": "agent-123-abc",
  "direction": "inbound",
  "enabled": true,
  "metadata": {}
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | `"webhook"` | `webhook`, `telegram`, `discord`, `email`, `slack` |
| `id` | string | auto-generated | Custom channel ID |
| `agentId` | string | -- | Agent to route messages to |
| `direction` | string | varies by type | `inbound` or `bidirectional` |
| `enabled` | boolean | `true` | Whether the channel is active |
| `metadata` | object | `{}` | Channel-specific configuration |

Default direction: `webhook` = inbound, all others = bidirectional.

**Response** `201`:
```json
{
  "channel": {
    "id": "ch_abc123",
    "type": "webhook",
    "direction": "inbound",
    "agentId": "agent-123-abc",
    "enabled": true,
    "metadata": { "webhookSecret": "secret-uuid" }
  },
  "webhookUrl": "https://relay.example.com/webhook/ch_abc123?token=secret-uuid"
}
```

#### `PATCH /channels/{channelId}`

Update a channel's name, prompt, or allowlist. Requires Bearer auth.

**Request body**:
```json
{
  "name": "Deploy Notifications",
  "prompt": "Summarize this deploy notification and flag any failures",
  "metadata": {
    "allowedUsers": ["user123", "user456"]
  }
}
```

Only `allowedUsers` can be modified via metadata -- other metadata fields are protected.

**Response** `200`:
```json
{
  "ok": true,
  "channel": { ... }
}
```

#### `DELETE /channels/{channelId}`

Delete a channel permanently. Requires Bearer auth.

**Response** `200`:
```json
{ "ok": true }
```

---

### Channel Registration

#### `POST /channels/telegram/register`

Register a Telegram bot as a bidirectional channel. Requires Bearer auth.

The server validates the bot token via Telegram's `getMe`, sets the Telegram webhook URL, generates a pairing code, and encrypts the bot token before storing.

**Request body**:
```json
{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "agentId": "agent-123-abc"
}
```

**Response** `201`:
```json
{
  "channelId": "ch_abc123",
  "botUsername": "my_chaos_bot",
  "pairingCode": "A1B2C3D4"
}
```

After registration, send the pairing code to the bot in Telegram to complete setup.

#### `POST /channels/discord/register`

Register a Discord bot as a bidirectional channel. Requires Bearer auth. Same flow as Telegram.

**Request body**:
```json
{
  "botToken": "discord-bot-token",
  "agentId": "agent-123-abc"
}
```

**Response** `201`:
```json
{
  "channelId": "ch_abc123",
  "botUsername": "my_chaos_bot",
  "pairingCode": "A1B2C3D4"
}
```

#### `POST /channels/email/register`

Register an email channel. Requires Bearer auth. Requires `CHAOS_EMAIL_DOMAIN` on the server.

**Request body**:
```json
{
  "userEmail": "user@example.com",
  "channelName": "Work Email",
  "agentId": "agent-123-abc"
}
```

**Response** `201`:
```json
{
  "channelId": "ch_abc123",
  "inboundAddress": "ch_abc123@relay.example.com"
}
```

The channel is pending until the user clicks the verification link sent to `userEmail`.

---

### Webhooks (Inbound)

These endpoints receive messages from external services. Authentication varies by channel type.

#### `POST /webhook/{channelId}?token={secret}`

Generic webhook ingestion. The body format is flexible:

| Field (alternatives) | Description |
|---------------------|-------------|
| `content` (or `text`, `message`, `body`) | Message content |
| `from` (or `sender`, `username`) | Sender identifier |
| `metadata` | Additional data passed through |

**Response** `200`:
```json
{ "ok": true, "messageId": "msg_abc123" }
```

#### `POST /telegram/{channelId}`

Receives Telegram Update objects. URL set automatically during registration. The server parses the update, extracts content and sender, enforces the allowlist, and checks pairing codes.

#### `POST /discord/{channelId}`

Receives Discord interaction payloads. URL set automatically during registration.

#### `POST /email/inbound`

Receives inbound emails from the email provider (e.g., Resend). Routes based on recipient address.

#### `GET /email/verify?token={token}&channelId={id}`

Email verification link. Marks an email channel as verified.

---

### WebSocket

#### `GET /ws?token={apiKey}`

Upgrades to a WebSocket connection for real-time message delivery.

**On connect**: The server sends any messages from the last 5 minutes that may have been missed.

**Server to client messages**:

| Type | Payload | Description |
|------|---------|-------------|
| `message` | `{ type: "message", message: ChannelMessage }` | New inbound message |
| `pong` | `{ type: "pong" }` | Keepalive response |
| `reply_ack` | `{ type: "reply_ack", ok: true, channelType, channelId }` | Reply acknowledgement |
| `error` | `{ type: "error", error: "..." }` | Error message |

**Client to server messages**:

| Type | Payload | Description |
|------|---------|-------------|
| `reply` | `{ type: "reply", channelId, content, channelType?, replyTo?, metadata? }` | Send a reply |
| `ping` | `{ type: "ping" }` | Keepalive ping |

On Deno Deploy, the server uses `kv.watch()` to push new messages in real time across isolates.

---

### Admin

All admin endpoints require the `chaos_admin` session cookie or the `CHAOS_ADMIN_KEY` environment variable to be set on the server.

#### `GET /admin/login`

Serves the HTML login form. Returns `503` if `CHAOS_ADMIN_KEY` is not set.

#### `POST /admin/login`

Authenticate with admin password. Sets `chaos_admin` cookie (HttpOnly, SameSite=Strict, 24h TTL).

**Request body**:
```json
{ "password": "the-admin-key" }
```

#### `GET /admin`

Admin dashboard HTML page. Redirects to `/admin/login` if not authenticated. Auto-refreshes every 10 seconds.

#### `GET /admin/status`

JSON API for the dashboard. Returns server status, active sessions with channels, and recent messages.

**Response** `200`:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "kv": true,
  "websockets": 3,
  "uptime": 12345,
  "sessions": [
    {
      "userId": "usr_123",
      "channels": [
        { "id": "ch_1", "type": "telegram", "agentId": "agent-1", "enabled": true }
      ],
      "createdAt": "2025-01-15T10:00:00Z",
      "wsConnections": 1
    }
  ],
  "recentMessages": [
    {
      "id": "msg_1",
      "userId": "usr_123",
      "channelType": "telegram",
      "channelId": "ch_1",
      "from": "user",
      "direction": "in",
      "content": "Hello agent...",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

#### `DELETE /admin/sessions/{userId}`

Delete a user session and all associated channels.

#### `POST /admin/logout`

Clear admin session cookie. Redirects to login page.

---

## Data Types

### ChannelMessage

```typescript
interface ChannelMessage {
  id: string;
  channelType: "webhook" | "telegram" | "discord" | "email" | "slack";
  channelId: string;
  from: string;
  content: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}
```

### ChannelConfig

```typescript
interface ChannelConfig {
  id: string;
  name?: string;
  type: "webhook" | "telegram" | "discord" | "email" | "slack";
  direction: "inbound" | "bidirectional";
  prompt?: string;
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}
```

### Error Response

All error responses follow this format:

```json
{ "error": "Human-readable error message" }
```

Common HTTP status codes:
- `400` -- Bad request (missing fields, invalid data)
- `401` -- Unauthorized (missing or invalid authentication)
- `404` -- Not found (channel, session, etc.)
- `429` -- Rate limited
- `503` -- Service unavailable (feature not configured)
