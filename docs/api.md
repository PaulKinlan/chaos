# CHAOS Relay Server API Reference

Base URL: Deployed on Deno Deploy (or `http://localhost:8787` for local development).

All authenticated endpoints require `Authorization: Bearer {apiKey}` unless noted otherwise.

CORS is enabled for all origins (`Access-Control-Allow-Origin: *`).

---

## Public Endpoints

### `GET /health`

Health check and server status.

**Auth:** None

**Response:**
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
| `websockets` | number | Active WebSocket connections |
| `uptime` | number | Seconds since server start |

---

### `POST /auth/register`

Register a new session. Returns credentials for all subsequent API calls.

**Auth:** None

**Rate Limit:** 5 per hour per IP

**Request Body (optional):**
```json
{
  "publicKey": { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `publicKey` | JsonWebKey | No | ECDSA P-256 public key for request signing |

**Response (201):**
```json
{
  "userId": "usr_abc123",
  "apiKey": "key_xyz789",
  "serverPublicKey": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Unique user identifier |
| `apiKey` | string | Bearer token for all authenticated requests |
| `serverPublicKey` | JsonWebKey | Server's ECDSA P-256 public key for verifying server signatures |

---

### `POST /webhook/:channelId`

Ingest a webhook message from an external service.

**Auth:** URL query parameter `?token={webhookSecret}` (not Bearer)

**Rate Limit:** 60 per minute per channel

**Request Body:**
```json
{
  "content": "Build failed on main branch",
  "from": "GitHub Actions",
  "metadata": { "repo": "user/project", "run_id": 12345 }
}
```

The webhook handler accepts flexible body formats. The `content` field (or `text` or `message` or `body`) is extracted as the message content. `from` (or `sender` or `username`) identifies the sender.

**Response (200):**
```json
{
  "ok": true,
  "messageId": "msg_abc123"
}
```

**Error (404):** Channel not found or wrong token.

---

### `POST /telegram/:channelId`

Telegram Bot API webhook endpoint. Telegram sends updates here when the bot receives messages.

**Auth:** Webhook secret embedded in channel config (verified server-side)

**Rate Limit:** 60 per minute per channel

**Request Body:** Standard Telegram Update object (set by `setWebhook`).

**Response (200):**
```json
{ "ok": true }
```

The server parses the Telegram update, extracts the message content and sender, enforces the allowlist (if configured), checks the pairing code for first-time users, and stores it as a `ChannelMessage` for the extension to process.

---

### `GET /responses/:channelId`

Poll for agent responses to a specific channel. Used by external services that send webhooks and want to retrieve the agent's replies.

**Auth:** None

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | string (ISO 8601) | No | Only return responses after this timestamp |

**Response:**
```json
{
  "responses": [
    {
      "id": "resp_abc",
      "channelType": "webhook",
      "channelId": "ch_123",
      "content": "Agent's reply text",
      "replyTo": "msg_original",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ],
  "since": "2025-01-15T10:31:00Z"
}
```

---

## WebSocket

### `GET /ws`

Upgrade to WebSocket connection for real-time message delivery.

**Auth:** Query parameter `?token={apiKey}`

**Connection:**
```
wss://relay.example.com/ws?token={apiKey}
```

The server uses `kv.watch()` on Deno KV to push new messages to the client in real time, even across Deno Deploy isolates.

**On connect:** The server sends any messages from the last 5 minutes that may have been missed during reconnection.

**Server -> Client messages:**

```json
{
  "type": "message",
  "message": {
    "id": "msg_abc",
    "channelType": "telegram",
    "channelId": "ch_123",
    "from": "username",
    "content": "Hello agent",
    "timestamp": "2025-01-15T10:30:00Z",
    "metadata": {}
  }
}
```

```json
{ "type": "pong" }
```

```json
{
  "type": "reply_ack",
  "ok": true,
  "channelType": "telegram",
  "channelId": "ch_123"
}
```

```json
{
  "type": "error",
  "error": "Missing channelId or content"
}
```

**Client -> Server messages:**

Reply to a channel message:
```json
{
  "type": "reply",
  "channelType": "telegram",
  "channelId": "ch_123",
  "replyTo": "msg_abc",
  "content": "Here is the agent's response",
  "metadata": {}
}
```

Keepalive:
```json
{ "type": "ping" }
```

---

## Authenticated Endpoints

All endpoints below require `Authorization: Bearer {apiKey}`.

### `GET /messages`

Poll for new inbound messages.

**Rate Limit:** 120 per minute per user

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | string (ISO 8601) | No | Only return messages after this timestamp |

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_abc",
      "channelType": "webhook",
      "channelId": "ch_123",
      "from": "GitHub",
      "content": "Build succeeded",
      "timestamp": "2025-01-15T10:30:00Z",
      "metadata": {}
    }
  ],
  "since": "2025-01-15T10:31:00Z"
}
```

Use the returned `since` value as the `since` parameter for the next poll.

---

### `POST /reply`

Send a reply to a channel message.

**Rate Limit:** 30 per minute per user

**Request Body:**
```json
{
  "channelType": "telegram",
  "channelId": "ch_123",
  "replyTo": "msg_abc",
  "content": "Agent's response text",
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channelType` | string | No | Channel type hint |
| `channelId` | string | Yes | Target channel ID |
| `replyTo` | string | No | Original message ID to reply to |
| `content` | string | Yes | Reply text (sanitized server-side) |
| `metadata` | object | No | Channel-specific metadata |

**Response:**
```json
{
  "ok": true,
  "channelType": "telegram",
  "channelId": "ch_123"
}
```

For Telegram channels, the server calls the Telegram Bot API `sendMessage` endpoint. For webhook channels, the response is stored for retrieval via `GET /responses/:channelId`.

---

### `POST /channels`

Register a new channel.

**Rate Limit:** 10 per hour per user

**Request Body:**
```json
{
  "type": "webhook",
  "agentId": "agent-123-abc",
  "direction": "inbound",
  "enabled": true,
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | No | Channel type: `webhook`, `telegram`, `discord`, `email`, `slack`. Default: `webhook` |
| `id` | string | No | Custom channel ID. Auto-generated if omitted |
| `agentId` | string | No | Agent to route messages to |
| `direction` | string | No | `inbound` or `bidirectional`. Default varies by type |
| `enabled` | boolean | No | Whether the channel is active. Default: `true` |
| `metadata` | object | No | Channel-specific config |

Direction defaults: webhook = `inbound`, all others = `bidirectional`.

For webhook channels, a `webhookSecret` is auto-generated if not provided.

**Response (201):**
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

The `webhookUrl` is only returned for webhook-type channels.

---

### `GET /channels`

List all channels for the authenticated user.

**Response:**
```json
{
  "channels": [
    {
      "id": "ch_abc123",
      "type": "webhook",
      "direction": "inbound",
      "agentId": "agent-123-abc",
      "enabled": true,
      "metadata": { "webhookSecret": "..." }
    },
    {
      "id": "ch_def456",
      "type": "telegram",
      "direction": "bidirectional",
      "agentId": "agent-123-abc",
      "enabled": true,
      "metadata": { "botUsername": "my_chaos_bot" }
    }
  ]
}
```

---

### `PATCH /channels/:id`

Update a channel's configuration.

**Request Body:**
```json
{
  "name": "Deploy Notifications",
  "prompt": "Summarize this deploy notification and flag any failures",
  "metadata": {
    "allowedUsers": ["user123", "user456"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable label |
| `prompt` | string | Instructions for the agent when processing messages from this channel |
| `metadata.allowedUsers` | string[] | Allowlist of user identifiers (Telegram usernames, etc.) |

**Response:**
```json
{
  "ok": true,
  "channel": { ... }
}
```

---

### `DELETE /channels/:id`

Delete a channel.

**Response:**
```json
{ "ok": true }
```

**Error (404):** Channel not found.

---

### `POST /channels/telegram/register`

Register a Telegram bot as a bidirectional channel.

**Rate Limit:** 10 per hour per user (shares limit with `/channels`)

**Request Body:**
```json
{
  "botToken": "123456:ABC-DEF...",
  "agentId": "agent-123-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botToken` | string | Yes | Telegram Bot API token from @BotFather |
| `agentId` | string | No | Agent to route messages to |

The server:
1. Calls Telegram `getMe` to validate the token and get the bot username
2. Sets the Telegram webhook URL to `{serverUrl}/telegram/{channelId}`
3. Generates a pairing code for the owner to verify via Telegram
4. Encrypts the bot token before storing in KV

**Response (201):**
```json
{
  "channelId": "ch_abc123",
  "botUsername": "my_chaos_bot",
  "pairingCode": "A1B2C3D4"
}
```

After registration, send the pairing code to the bot in Telegram to complete the pairing. The bot will only respond to users in the allowlist (initially just the paired owner).

---

## Admin Endpoints

Admin endpoints are protected by session cookie auth. The admin password is set via the `CHAOS_ADMIN_KEY` environment variable.

### `GET /admin/login`

Serves the admin login HTML page.

**Auth:** None

---

### `POST /admin/login`

Authenticate as admin.

**Auth:** None

**Request Body:**
```json
{
  "password": "the-admin-key"
}
```

**Response (200):**
```json
{ "ok": true }
```

Sets a `chaos_admin` session cookie (HttpOnly, SameSite=Strict, 24-hour TTL).

**Error (401):** Invalid password.

---

### `GET /admin`

Serves the admin dashboard HTML page. Redirects to `/admin/login` if not authenticated.

The dashboard auto-refreshes every 10 seconds and shows:
- Server status (version, KV availability, WebSocket connections, uptime)
- Active sessions with their channels
- Recent messages (last 30)

---

### `GET /admin/status`

JSON API used by the admin dashboard.

**Auth:** Admin session cookie

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "kv": true,
  "websockets": 3,
  "uptime": 12345,
  "sessions": [
    {
      "userId": "usr_abc",
      "channels": [
        {
          "id": "ch_123",
          "type": "telegram",
          "agentId": "agent-123",
          "enabled": true,
          "botUsername": "my_bot",
          "allowedUsers": ["user1"],
          "hasPairingCode": false
        }
      ],
      "createdAt": "2025-01-15T10:00:00Z",
      "wsConnections": 1
    }
  ],
  "recentMessages": [
    {
      "id": "msg_abc",
      "userId": "usr_abc1",
      "channelType": "telegram",
      "channelId": "ch_12345",
      "from": "username",
      "direction": "in",
      "content": "Hello agent...",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

---

### `DELETE /admin/sessions/:userId`

Delete a user session and all its channels.

**Auth:** Admin session cookie

**Response:**
```json
{
  "ok": true,
  "deleted": "usr_abc123"
}
```

---

### `POST /admin/logout`

Log out of the admin dashboard. Clears the session cookie.

**Auth:** Admin session cookie

Redirects to `/admin/login`.

---

## Rate Limits

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /auth/register` | 5 | 1 hour | Client IP |
| `GET /messages` | 120 | 1 minute | User ID |
| `POST /reply` | 30 | 1 minute | User ID |
| `POST /webhook/:id` | 60 | 1 minute | Channel ID |
| `POST /telegram/:id` | 60 | 1 minute | Channel ID |
| `POST /channels` | 10 | 1 hour | User ID |
| `POST /channels/telegram/register` | 10 | 1 hour | User ID |

When rate limited, the server returns `429 Too Many Requests`:
```json
{
  "error": "Too many registration attempts. Try again later."
}
```

## Request Signing (Optional)

For enhanced security, the extension signs requests with ECDSA P-256:

**Headers:**
| Header | Description |
|--------|-------------|
| `X-Timestamp` | ISO 8601 timestamp of the request |
| `X-Nonce` | Random 16-byte hex string |
| `X-Signature` | Base64-encoded ECDSA-SHA256 signature |

**Signed payload:** `{timestamp}\n{nonce}\n{path}\n{bodyHash}`

Where `bodyHash` is the SHA-256 hex digest of the request body (or empty string if no body).

The server verifies signatures when present. Requests without signature headers are still accepted (backwards compatibility) but marked as `verified: false`.

## Error Format

All errors follow this format:
```json
{
  "error": "Human-readable error message"
}
```

Common status codes:
- `400` -- Bad request (missing fields, invalid JSON)
- `401` -- Unauthorized (missing or invalid auth)
- `404` -- Not found (unknown route or resource)
- `429` -- Rate limited
- `503` -- Service unavailable (admin not configured)
