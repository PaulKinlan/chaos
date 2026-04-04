# CHAOS Security Model

## Data Flow

CHAOS has three distinct data paths:

### 1. Local-only (Extension)
- Agent configurations, conversation history, and settings are stored in **OPFS** (Origin Private File System) and **chrome.storage**
- Page content extracted by tools (readability, screenshots, DOM access) stays in the extension's local storage
- Scheduled tasks and their results are stored locally

### 2. Extension to AI Providers
- When an agent processes a message, the prompt (which may include page content, user instructions, and conversation history) is sent to the configured AI provider (Anthropic, Google, OpenAI, or OpenRouter)
- **What is sent:** system prompt, agent instructions, tool results (page content, screenshots, etc.), and the conversation thread
- **What is NOT sent:** other agents' data, browser history beyond the active tab, stored credentials
- Each AI provider has its own data retention and privacy policy. Users choose their provider and supply their own API keys.

### 3. Extension to Relay Server (Channels feature)
- When channels are enabled, the extension polls the relay server for incoming messages from external platforms (Discord, Telegram, Slack, email, webhooks)
- **Inbound:** The relay server receives messages from external platforms and holds them until the extension polls. Message content, sender info, and channel metadata pass through the server.
- **Outbound:** When an agent replies, the response is sent from the extension to the relay server, which forwards it to the external platform.
- **Bot tokens and webhook URLs** are stored in the relay server's configuration (not in the extension).

## Encryption

### In Transit
- All communication between the extension and AI providers uses HTTPS/TLS
- All communication between the extension and the relay server uses HTTPS/TLS
- External channel connections (Discord bot, Telegram bot, etc.) use the platform's standard TLS connections

### At Rest
- Local extension data (OPFS, chrome.storage) is protected by Chrome's sandboxing model
- Relay server message queue: messages are held in memory or short-lived storage and deleted after delivery. No long-term persistence of message content.
- Bot tokens and channel credentials on the relay server are stored in environment variables or encrypted configuration, not in plaintext on disk

## Authentication and Authorization

### OAuth Flow
1. User initiates auth from the extension settings
2. Extension uses `chrome.identity.launchWebAuthFlow` to open the OAuth consent screen
3. User authenticates with their Google account and grants requested scopes
4. OAuth provider returns an authorization code to the extension's redirect URL
5. Extension exchanges the code for access and refresh tokens
6. Tokens are stored in `chrome.storage.local` (encrypted by Chrome's storage layer)
7. Refresh tokens are used to obtain new access tokens transparently

### Token Lifecycle
- **Access tokens** expire after ~1 hour and are refreshed automatically
- **Refresh tokens** persist until revoked by the user or the OAuth provider
- Users can revoke access at any time from the extension settings or from their Google account security page
- On extension uninstall, all local storage (including tokens) is deleted by Chrome

### Relay Server Auth (Detailed Crypto Model)

The relay server is a direct pipe into the user's browser agents. It needs strong security across three attack surfaces:

#### Attack Surface 1: External → Relay (webhook spoofing)

Malicious actors could send fake webhook payloads to inject messages into a user's agent.

**Mitigations:**
- Each webhook channel has a unique secret token in its URL path (e.g. `/webhook/{channelId}?token={secret}`)
- Webhook secrets are cryptographically random (32 bytes, hex-encoded)
- For platforms that support it (Telegram, Discord), verify platform-specific signatures on incoming webhooks
- Rate limiting per webhook endpoint (max 60 requests/minute per channel)
- Payload size limits (max 64KB per webhook)
- Message content is sanitized before storage (strip HTML, limit length)

#### Attack Surface 2: Relay → Extension (relay impersonation)

A man-in-the-middle could impersonate the relay to send malicious instructions to the extension.

**Mitigations:**
- TLS required (extension only connects to HTTPS relay URLs, except localhost for dev)
- **Asymmetric key pair**: On first connection, the extension generates an Ed25519 keypair using `crypto.subtle`
  - Private key stays in `chrome.storage.local` (never leaves the extension)
  - Public key is sent to the relay during registration
  - Relay signs all responses with a server keypair
  - Extension verifies server signatures on all poll responses
- **Pinned server identity**: After first connection, the extension stores the relay's public key and rejects responses signed by a different key (TOFU - Trust On First Use)

#### Attack Surface 3: Extension → Relay (key theft / replay)

A stolen API key could let an attacker poll another user's messages or send replies as them.

**Mitigations:**
- **Request signing**: Extension signs every request with its private key (Ed25519)
  - Signed payload includes: timestamp, request path, body hash
  - Relay verifies the signature using the stored public key
  - Requests older than 5 minutes are rejected (replay protection)
- **API key rotation**: Keys can be rotated from extension settings
- **Session binding**: API key is bound to the extension's public key at registration time
- **Per-message nonces**: Each poll request includes a random nonce, relay tracks seen nonces for replay detection

#### Key Exchange Flow

```
1. Extension generates Ed25519 keypair (crypto.subtle)
   → privateKey stored in chrome.storage.local
   → publicKey exported as JWK

2. POST /auth/register
   Body: { publicKey: JWK }
   Response: { userId, apiKey, serverPublicKey: JWK }

3. Extension stores: apiKey, serverPublicKey, userId

4. Every subsequent request:
   Headers: {
     Authorization: Bearer {apiKey}
     X-Timestamp: ISO 8601
     X-Nonce: random 16 bytes hex
     X-Signature: Ed25519 sign({timestamp}|{nonce}|{path}|{bodyHash})
   }

5. Relay verifies:
   - API key is valid
   - Timestamp is within 5 minutes
   - Nonce hasn't been seen before
   - Signature is valid for the registered public key
```

#### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| POST /auth/register | 5/hour per IP |
| GET /messages | 120/minute per user |
| POST /reply | 30/minute per user |
| POST /webhook/* | 60/minute per channel |
| POST /channels | 10/hour per user |

#### Message Lifecycle

- Messages are stored in memory only (no disk persistence)
- Messages auto-expire after 24 hours
- Messages are deleted after successful delivery (extension polls and acknowledges)
- Bot tokens are stored in-memory only (lost on server restart, must be re-registered)
- For production: bot tokens should be encrypted at rest using a server-side encryption key

### Current Implementation Status

**Implemented:**
- API key auth (basic)
- Webhook secret tokens
- CORS headers

**TODO (before production):**
- [ ] Ed25519 keypair generation in extension
- [ ] Request signing and verification
- [ ] Server-side response signing
- [ ] Nonce tracking for replay protection
- [ ] Rate limiting
- [ ] Message expiry
- [ ] Payload size limits
- [ ] Content sanitization
- [ ] HTTPS enforcement (except localhost)
- [ ] Bot token encryption at rest

## Channel Ownership Verification
- When connecting a Discord bot, the user must provide their own bot token (proving they control the bot)
- When connecting a Telegram bot, the user must provide their own BotFather token
- Webhook channels require the user to configure the webhook URL on their own infrastructure
- Email channels use OAuth to verify the user owns the email account
- The relay server does not allow one user to receive messages from another user's channels

## Self-Hosting
For privacy-sensitive users, the relay server can be self-hosted:
- The server is a standalone Deno application with no external dependencies beyond the channel APIs
- Deploy on any infrastructure: VPS, home server, Cloudflare Workers, or any Deno-compatible platform
- Point the extension to the custom relay server URL in settings
- All message data stays on infrastructure the user controls

## What Stays Local vs. What Goes to the Server

| Data | Location |
|------|----------|
| Agent configurations | Local (OPFS, chrome.storage) |
| Conversation history | Local (OPFS) |
| API keys for AI providers | Local (chrome.storage) |
| Page content extracted by tools | Local (in-memory during processing) |
| Scheduled task definitions | Local (chrome.storage) |
| Channel messages (in transit) | Relay server (temporary) |
| Bot tokens / webhook URLs | Relay server (configuration) |
| Channel routing config | Relay server |
| OAuth tokens | Local (chrome.storage) |
