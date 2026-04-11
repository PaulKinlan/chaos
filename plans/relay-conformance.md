# Plan: Relay Server Specification & Conformance Suite

## Status

**Audited 2026-04-07**

### Phase 1: OpenAPI Specification — DONE
- [x] docs/relay-openapi.yaml (1591 lines, all 19 endpoints)

### Phase 2: Conformance Test Suite — DONE
- [x] 38 tests across 5 files (health, auth, channels, flow, websocket)
- [x] All passing against our implementation
- [x] Added to CI (runs on every push)

### Phase 3: Client SDK Specification — PARTIAL (docs only)
- [x] Registration flow documentation (in `docs/relay-api-spec.md`)
- [x] Request signing documentation (in `docs/relay-api-spec.md`)
- [x] WebSocket connection documentation (in `docs/relay-api-spec.md`)
- [x] Channel management documentation (in `docs/relay-api-spec.md`)
- [x] Message processing documentation (in `docs/relay-api-spec.md`)
- [ ] Polling strategy documentation (detailed backoff/timing guide)
- [ ] Standalone SDK specification document

### Phase 4: Self-Hosting Guide — DONE
- [x] `docs/relay-self-hosting.md` — comprehensive self-hosting guide
- [x] Docker image instructions and Dockerfile
- [x] docker-compose.yml
- [x] Environment variable documentation (all 9 variables)
- [x] Reverse proxy setup (nginx and Caddy)
- [x] Deployment guides (Deno Deploy, Docker, Fly.io, generic VPS)
- [x] Security considerations
- [x] Monitoring and admin dashboard

### Phase 5: Reference Client Library — TODO (documentation done)
- [ ] `@chaos/relay-client` standalone package
- [ ] Typed methods for all endpoints
- [ ] Works in any JavaScript environment

---

## Problem

The relay server is currently one implementation (Deno Deploy). For CHAOS to be truly open:

1. **Third-party clients** should be able to talk to our relay (not just our extension)
2. **Third-party relays** should be able to replace ours (self-hosted, different platforms)
3. Both directions need a formal spec and validation tests

Without a spec, the relay protocol is implicitly defined by whatever our code happens to do today. Breaking changes, undocumented behaviour, and incompatibilities are inevitable.

## Goals

- **OpenAPI specification** for the relay server API
- **Conformance test suite** that validates any relay implementation
- **Client SDK** specification so any client can integrate
- **Self-hosting guide** with Docker/Deno/Node instructions

## Architecture

```
┌─────────────────────────────────────────────┐
│              Relay Specification             │
│  (OpenAPI 3.1 YAML + Protocol Documentation)│
└──────────────────┬──────────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
┌──────┴──────┐       ┌───────┴───────┐
│ Conformance │       │ Client SDK    │
│ Test Suite  │       │ Specification │
│ (Deno/Node) │       │               │
└──────┬──────┘       └───────┬───────┘
       │                       │
       │  validates            │  implements
       │                       │
┌──────┴──────┐       ┌───────┴───────┐
│ Any Relay   │       │ Any Client    │
│ Server      │       │ (Extension,   │
│ (Deno, Node,│       │  CLI, SDK,    │
│  Go, Rust)  │       │  3rd party)   │
└─────────────┘       └───────────────┘
```

## Relay Protocol Specification

### Core Concepts

1. **Sessions** — A client registers with a public key, gets a userId + apiKey
2. **Channels** — Named communication endpoints (webhook, telegram, discord, email)
3. **Messages** — Inbound data from channels, stored temporarily (24hr TTL)
4. **Responses** — Outbound replies from the client, routed back to the channel
5. **WebSocket** — Real-time message delivery (optional, falls back to polling)
6. **Authentication** — ECDSA P-256 request signing OR Bearer token

### Endpoints (to be specified in OpenAPI)

#### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | None | Register a new session with optional public key |

#### Messages
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /messages | Bearer | Poll for new messages (since timestamp) |
| POST | /reply | Bearer | Send a response to a channel |
| GET | /responses/:channelId | None | Poll for agent responses (external services) |

#### Channels
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /channels | Bearer | List configured channels |
| POST | /channels | Bearer | Register a new channel |
| PATCH | /channels/:id | Bearer | Update channel metadata |
| DELETE | /channels/:id | Bearer | Remove a channel |
| POST | /channels/telegram/register | Bearer | Register a Telegram bot |
| POST | /channels/discord/register | Bearer | Register a Discord bot |
| POST | /channels/email/register | Bearer | Register an email channel |

#### Webhooks (Inbound, no Bearer auth)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhook/:channelId | Token in URL | Generic webhook |
| POST | /telegram/:channelId | Secret in URL | Telegram webhook |
| POST | /discord/:channelId | Secret in URL | Discord webhook |
| POST | /email/inbound | None | Resend email webhook |

#### Real-time
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /ws | Token in URL | WebSocket upgrade |

#### System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Server status |

### Request Signing Protocol

For signed requests, the client adds:
- `Authorization: Bearer {apiKey}`
- `X-Timestamp: {ISO 8601}` (must be within 5 minutes)
- `X-Nonce: {random hex}` (unique per request)
- `X-Signature: {base64 ECDSA-SHA256 signature}`

Signature is computed over: `{timestamp}|{nonce}|{path}|{bodyHash}`
Where bodyHash is SHA-256 of the request body (empty string for GET).

Unsigned requests (legacy) include only `Authorization: Bearer {apiKey}`.

### Message Format

```typescript
interface ChannelMessage {
  id: string;
  channelType: 'webhook' | 'telegram' | 'discord' | 'email' | 'slack';
  channelId: string;
  from: string;
  content: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}
```

### WebSocket Protocol

After upgrade, the server:
1. Sends missed messages from the last 5 minutes
2. Watches KV for new messages and pushes them as `{ type: 'message', message: ChannelMessage }`

Client can send:
- `{ type: 'reply', channelType, channelId, content, metadata }` — send a response
- `{ type: 'ping' }` — keepalive, server responds with `{ type: 'pong' }`

## Implementation Phases

### Phase 1: OpenAPI Specification

1. Write `docs/relay-openapi.yaml` in OpenAPI 3.1 format
2. Document all endpoints with request/response schemas
3. Document authentication schemes
4. Include examples for each endpoint
5. Generate HTML documentation from the spec

### Phase 2: Conformance Test Suite

Create `packages/server/tests/conformance/` with tests that:

1. **Can run against ANY server URL** — takes a base URL as config
2. **Tests each endpoint** independently
3. **Tests the full flow**: register → create channel → receive webhook → poll messages → send reply
4. **Tests authentication**: valid/invalid tokens, signature verification, nonce replay protection
5. **Tests WebSocket**: connect, receive messages, send replies, reconnect
6. **Tests rate limiting**: verify limits are enforced
7. **Tests error handling**: malformed requests, missing fields, invalid JSON

Test runner: Deno test or Vitest, configurable target URL.

```bash
# Test our production relay
deno task test:conformance --url https://chaos--main.paulkinlan-ea.deno.net

# Test a local instance
deno task test:conformance --url http://localhost:8787

# Test a third-party implementation
deno task test:conformance --url https://my-relay.example.com
```

### Phase 3: Client SDK Specification

Document the client-side protocol so anyone can build a compatible client:

1. Registration flow (ECDSA keypair generation, public key submission)
2. Request signing (timestamp, nonce, ECDSA-SHA256)
3. Polling strategy (alarm-based, with since timestamps)
4. WebSocket connection (URL construction, reconnect backoff)
5. Channel management (CRUD, per-type registration)
6. Message processing (deduplication, direction checking)

### Phase 4: Self-Hosting Guide

1. Docker image for the relay server
2. docker-compose.yml with Deno KV SQLite backend
3. Environment variable documentation
4. Reverse proxy setup (nginx, Caddy)
5. Domain and TLS configuration
6. Deno Deploy quickstart (current approach)
7. Fly.io / Railway / Render deployment guides

### Phase 5: Reference Client Library

A minimal TypeScript client library (`@chaos/relay-client`) that:
1. Handles registration and key management
2. Signs requests
3. Manages WebSocket connections with reconnect
4. Provides typed methods for all endpoints
5. Can be used in any JavaScript environment (browser, Node, Deno)

## Open Questions

1. **Versioning**: Should the API be versioned (/v1/messages)? Or rely on backwards-compatible evolution?
2. **Rate limits**: Should the spec mandate specific rate limits, or just require that some form of rate limiting exists?
3. **Storage requirements**: Must a conforming relay use persistent storage? Or can ephemeral (in-memory) relays be valid for testing?
4. **WebSocket**: Is WebSocket support mandatory, or optional? Polling should always work as the baseline.
5. **Channel-specific endpoints**: Should /telegram/, /discord/, etc. be part of the core spec, or extensions?
