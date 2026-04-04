# Plan: External Channels

## Problem

Right now CHAOS agents can only be triggered by:
- Direct chat in the NTP
- Chrome events (hooks)
- Scheduled alarms
- Context menu

But users interact with the world through many channels: Discord, Telegram, email, Slack, etc. An agent should be able to receive messages from these channels and respond through them too.

## Vision

An agent can be connected to one or more external channels. When a message arrives on a channel, it triggers the agent's agentic loop. The agent's response is sent back through the same channel. The agent has the full tool set (browser, files, search, etc.) regardless of which channel triggered it.

```
Discord message → CHAOS agent → agentic loop → response → Discord reply
Telegram message → CHAOS agent → agentic loop → response → Telegram reply
Email received → CHAOS agent → agentic loop → response → Email reply
```

## Architecture Options

### Option A: Extension-native (WebSocket/polling from service worker)

The Chrome extension's service worker connects directly to external services.

**Discord**: Use Discord bot API via WebSocket gateway from the service worker. The extension holds the bot token and maintains a WebSocket connection (or polls via REST).

**Telegram**: Use Telegram Bot API via long polling from the service worker. Simpler than Discord since Telegram's bot API is HTTP-based.

**Pros**: Everything stays in the extension. No external server needed. Full tool access.
**Cons**: Service worker lifecycle is problematic. MV3 kills service workers after 30s of inactivity. WebSocket connections will drop. Long polling needs keepalive hacks. Not reliable for real-time messaging.

### Option B: External relay server (recommended)

A lightweight relay server (Cloudflare Worker, Deno Deploy, or similar) receives messages from external channels and forwards them to the extension via a push mechanism.

```
Discord → Relay Server → Chrome Extension (via polling or push)
                       ← Response back to Discord
```

**How it works:**
1. Relay server hosts the Discord/Telegram bot
2. When a message arrives, relay stores it in a queue (KV, D1, or in-memory)
3. Extension polls the relay every N seconds for new messages (via alarm + fetch)
4. Extension processes the message through the agentic loop
5. Extension sends the response back to the relay via HTTP POST
6. Relay forwards the response to the originating channel

**Pros**: Reliable. Service worker lifecycle doesn't matter (polling via alarms works). The relay is stateless/cheap. Can support many channels.
**Cons**: Requires deploying a server. Adds latency from polling interval. Needs auth between extension and relay.

### Option C: Hybrid (emaila.gent pattern)

Use email as the universal channel, like emaila.gent does. External services (Discord, Telegram) forward messages to an email address. The extension polls for new emails.

**Pros**: Simple. Email is universal. emaila.gent already has the pattern.
**Cons**: Slow (email delivery + polling). Not real-time. Email-specific formatting issues.

## Recommended: Option B with Cloudflare Workers

### Relay Server Design

A Cloudflare Worker that:
- Receives Discord/Telegram webhook events
- Stores pending messages in KV (keyed by user/agent)
- Exposes a REST API for the extension:
  - `GET /messages?since=timestamp` - poll for new messages
  - `POST /reply` - send a response back to the channel
  - `POST /register` - register a channel connection
- Handles auth via a shared secret (stored in extension settings)

### Extension Integration

New module: `src/channels/`

```
src/channels/
  types.ts          # ChannelMessage, ChannelConfig types
  polling.ts        # Alarm-based polling for new messages
  relay-client.ts   # HTTP client for the relay server
  discord.ts        # Discord-specific message formatting
  telegram.ts       # Telegram-specific message formatting
  index.ts          # Channel manager
```

**Channel configuration** (stored in chrome.storage.local):
```typescript
interface ChannelConfig {
  id: string;
  type: 'discord' | 'telegram' | 'email';
  agentId: string;           // Which agent handles this channel
  relayUrl: string;          // URL of the relay server
  relaySecret: string;       // Auth token
  enabled: boolean;
  pollIntervalMinutes: number; // How often to check (default: 1)
  metadata: {                // Channel-specific config
    discordChannelId?: string;
    telegramChatId?: string;
    emailAddress?: string;
  };
}
```

**Polling flow:**
1. Chrome alarm fires every N minutes
2. Extension fetches new messages from relay: `GET /messages?since=lastPoll`
3. For each message, runs the agentic loop with the message content
4. Sends the response back: `POST /reply` with channel info + response text
5. Updates lastPoll timestamp

**UI integration:**
- New sidebar item: "Channels" (between Hooks and Agent Settings)
- Shows configured channels per agent
- Add channel form: pick type, enter relay URL + secret, configure
- Channel activity log: see incoming/outgoing messages

### Discord Bot Setup

1. User creates a Discord bot at discord.com/developers
2. User deploys the relay worker (one-click Cloudflare deploy)
3. User enters the relay URL + secret in CHAOS settings
4. User adds the Discord bot to their server
5. Messages to the bot are forwarded to CHAOS via the relay

The relay worker for Discord:
- Registers Discord interaction endpoint
- Handles MESSAGE_CREATE events
- Stores messages in KV
- Serves them to the extension via polling
- Forwards extension responses back as Discord messages

### Telegram Bot Setup

Similar to Discord but simpler:
1. User creates a Telegram bot via @BotFather
2. Configures webhook pointing to the relay worker
3. Relay stores messages, extension polls and responds

### Email Channel

Could reuse emaila.gent's Resend-based approach:
- Inbound email webhook → relay → extension
- Extension response → relay → outbound email via Resend

## Implementation Phases

### Phase 1: Core channel infrastructure
- `src/channels/` module with types, polling, relay client
- Channel config UI in the sidebar
- Alarm-based polling
- Generic message handling (channel message → agentic loop → response)

### Phase 2: Discord relay worker
- Cloudflare Worker template for Discord
- One-click deploy instructions
- Discord message formatting (embeds, mentions, etc.)

### Phase 3: Telegram relay worker
- Cloudflare Worker template for Telegram
- Telegram message formatting (markdown, reply threading)

### Phase 4: Email channel
- Resend integration (or other email provider)
- Email parsing and formatting

### Phase 5: Advanced features
- Rich message formatting per channel (Discord embeds, Telegram inline keyboards)
- File/image handling across channels
- Multi-channel coordination (same agent responds across channels)
- Rate limiting per channel
- Channel-specific hooks (e.g. "when someone @mentions me in Discord")

## Authentication & Channel Ownership

This is critical. The relay server sits between the user's Chrome extension and external channels. We need to know:
1. Who is this user? (identity)
2. Do they own this channel/bot? (ownership verification)
3. Is this extension instance authorized to send/receive? (session auth)

### Identity: chrome.identity OAuth

Chrome extensions have `chrome.identity.getAuthToken()` which provides Google OAuth. This is the most natural fit:

**How it works:**
1. Extension calls `chrome.identity.getAuthToken({ interactive: true })` → user signs in with Google
2. Extension gets an OAuth access token tied to the user's Google account
3. Extension sends this token to the relay server on first connection
4. Server verifies the token with Google's tokeninfo endpoint
5. Server creates/finds a user account linked to that Google ID
6. Server returns a session token for subsequent requests

**What we need to set up:**
- A Google Cloud project with OAuth consent screen
- OAuth client ID for Chrome extension (`chrome-extension://` redirect)
- Add `identity` to manifest.json permissions
- Configure allowed scopes (just `email` and `profile` is enough for identity)

**Pros:**
- Built into Chrome, zero-friction for users
- Google account is universally available
- No custom auth UI needed
- Token verification is well-documented

**Cons:**
- Ties identity to Google (some users may object)
- Requires Google Cloud project setup and maintenance
- OAuth consent screen review for publishing

### Channel ownership verification

Once we know WHO the user is, we need to verify they own the channels they want to connect.

**Discord bot:**
```
1. User creates a Discord bot at discord.com/developers
2. User enters bot token in CHAOS settings
3. CHAOS relay server validates the bot token (GET /api/users/@me)
4. If valid, server stores: user_id → discord_bot_token (encrypted)
5. Server starts receiving Discord events for this bot
```

The user proves ownership by providing the bot token, which only the bot creator has.

**Telegram bot:**
```
1. User creates bot via @BotFather, gets a token
2. User enters token in CHAOS settings
3. Server validates via Telegram API (getMe)
4. Server sets webhook to point to relay
5. Stores: user_id → telegram_bot_token (encrypted)
```

Same pattern — bot token proves ownership.

**Email:**
```
1. Server assigns a unique inbound email address (e.g. user-xyz@chaos-relay.example)
2. User verifies by receiving a confirmation email
3. Or: user configures their own email forwarding to the relay
```

**Generic webhook:**
```
1. Server generates a unique webhook URL for the user
2. User configures their service to POST to that URL
3. Webhook URL includes a secret token that proves it's for this user
```

### Session auth (extension ↔ server)

After initial OAuth, the extension needs ongoing auth for polling:

**Option A: JWT session tokens**
```
1. Extension authenticates via Google OAuth
2. Server issues a JWT (expires in 30 days, refreshable)
3. Extension stores JWT in chrome.storage.local
4. All subsequent requests include: Authorization: Bearer <JWT>
5. Server validates JWT on each request
```

**Option B: API keys**
```
1. After OAuth, server generates an API key for the user
2. Extension stores it in chrome.storage.local
3. All requests include: X-API-Key: <key>
4. Simpler than JWT but no expiry (must be manually revoked)
```

**Recommendation:** JWT with refresh. More secure, auto-expires, standard.

### Multi-device support

A user might have CHAOS installed on multiple machines. Each extension instance needs its own session but shares the same user account and channels.

```
User (Google account) → Server account
  ├── Extension instance 1 (home laptop) → Session token A
  ├── Extension instance 2 (work desktop) → Session token B
  └── Channels (shared across instances)
       ├── Discord bot
       ├── Telegram bot
       └── Email
```

Messages from channels are available to ALL extension instances. Each instance polls independently.

### Pairing flow (inspired by OpenClaw / Claude Code channels)

For channels where someone else initiates contact (e.g., a Discord user DMs the bot), we need pairing:

```
1. Unknown Discord user sends a message to the bot
2. Server stores the message as "pending pairing"
3. Extension shows: "New contact from Discord user @alice. Approve?"
4. User approves → messages from @alice are now routed to the agent
5. User can set per-contact policies (allow DMs, allow groups, block)
```

This is the same pattern used by the Telegram/Discord channel plugins in Claude Code.

### Security concerns

- **Bot tokens**: Stored encrypted on the server, never sent back to the extension after initial submission
- **OAuth tokens**: Short-lived, verified server-side, not stored long-term
- **Message content**: Passes through the relay server. For sensitive use cases, the server should be self-hosted. Document this clearly.
- **Channel isolation**: One user's channels can't be accessed by another user
- **Rate limiting**: Per-user rate limits on the relay to prevent abuse

### Setup flow (user experience)

```
1. Click "Channels" in CHAOS settings
2. "Sign in to enable channels" → chrome.identity OAuth popup
3. After sign in: "Connected as paul@example.com"
4. "Add Channel" → pick Discord/Telegram/Email/Webhook
5. For Discord: "Enter your Discord bot token" → paste → "Verified ✓"
6. "Which agent should handle Discord messages?" → pick agent
7. Done. Messages start flowing.
```

## Open Questions

1. **Auth model**: How does the relay authenticate with the extension? Shared secret is simple but needs rotation. OAuth would be more robust but complex.

2. **Push vs poll**: Polling via alarms works but adds latency (up to pollInterval). Could use a WebSocket from the NTP page (which stays open) as a faster path, falling back to alarm polling when NTP is closed.

3. **Message history**: Should channel messages be stored in the agent's conversation history? Probably yes, but they'd need to be distinguished from direct chat.

4. **Multi-user**: If the Discord bot is in a server with multiple people, should different users map to different agents? Or is it one agent per channel?

5. **Cost**: The agentic loop uses LLM tokens for every message. High-volume channels (busy Discord server) could get expensive. Need rate limiting or user confirmation for high-volume channels.

6. **Privacy**: Messages from external channels pass through the relay server. For sensitive use cases, the relay should be self-hosted. Document this clearly.

## Additional Channel Types

Beyond Discord/Telegram/Email, there are several other interesting channels:

### File System Observer (Chrome API)
Chrome's File System Observer API can watch for changes to local files. An agent could:
- Watch a project folder for code changes and auto-review
- Monitor a downloads folder and organize/summarize new files
- Watch a notes folder and index/cross-reference content
- Trigger on config file changes and validate them

Implementation: Use `FileSystemObserver` in the extension to watch user-selected directories. File change events trigger the agentic loop with the changed file content as context.

### Native Messaging (Native App Bridge)
Chrome's `chrome.runtime.connectNative()` allows the extension to communicate with a native application installed on the user's machine. This opens up:
- **Terminal/shell access**: Run commands on the local machine (git, npm, etc.)
- **Local file access**: Read/write files outside the browser sandbox
- **System notifications**: Native OS notifications with richer controls
- **Hardware integration**: Access to local devices, serial ports, USB
- **Process management**: Start/stop local services

Implementation: A small native host app (Node.js, Python, or Rust) that the extension communicates with via stdin/stdout JSON messages. Requires a native messaging manifest installed on the system.

### Webhooks (Generic HTTP)
A generic webhook receiver that any service can POST to:
- GitHub webhooks (PR created, issue opened, CI failed)
- Stripe webhooks (payment received, subscription changed)
- RSS/Atom feeds (new posts from blogs the user follows)
- IFTTT/Zapier integration
- Custom application events

Implementation: Part of the relay server. Generic webhook endpoint that stores events for the extension to poll.

### Calendar Integration
Google Calendar or other calendar APIs:
- Meeting starting in 5 minutes → agent prepares briefing notes
- Meeting just ended → agent prompts for notes/action items
- Free time detected → agent suggests tasks to work on

Implementation: Calendar API polling via the relay, or direct Google Calendar API access from the extension (with appropriate OAuth).

### Clipboard Monitoring
Watch the system clipboard for changes:
- User copies a URL → agent fetches and summarizes it
- User copies code → agent analyzes/explains it
- User copies an error message → agent searches for solutions

Implementation: Periodic clipboard read via `navigator.clipboard.readText()` (needs user gesture) or via the native app bridge.

### Screen/Tab Activity
Passive observation of browsing patterns:
- Time spent on specific sites → productivity insights
- Tab switching patterns → context detection
- Scroll depth on articles → reading engagement

Implementation: Content script or tab activity tracking via the existing Chrome APIs. Privacy-sensitive, should be opt-in with clear disclosure.

### Voice (Always-on)
Beyond the current push-to-talk:
- Wake word detection ("Hey Chaos...")
- Continuous ambient listening with keyword triggers
- Voice-activated hooks

Implementation: Would need the native app bridge for always-on mic access, since the extension can't maintain a persistent mic connection.

### Slack
Similar to Discord but for work contexts:
- Respond to DMs or @mentions
- Monitor specific channels
- Post updates/reports to channels

Implementation: Slack bot via relay server, same pattern as Discord.

### MCP Servers (Model Context Protocol)
Allow CHAOS agents to connect to MCP servers as a client:
- Access external tools and data sources
- Connect to databases, APIs, and services
- Use tools provided by other AI systems

Implementation: MCP client in the extension that connects to configured MCP servers. Tools from MCP servers are added to the agent's tool set dynamically.

## Monorepo Architecture

When we implement channels, we need a server component. Rather than creating separate repos, everything stays in one monorepo:

```
chaos/
  packages/
    extension/          # Chrome extension (current src/, app.html, manifest.json)
      src/
      app.html
      manifest.json
      vite.config.ts
      package.json

    server/             # Relay server for external channels
      src/
        channels/       # Per-channel handlers (discord, telegram, slack, email)
        relay/          # Message queue, polling endpoint, auth
        registry/       # Skills registry / marketplace API
        webhooks/       # Generic webhook receiver
      deno.json         # or package.json if Node

    web/                # Public website
      src/
      public/
      package.json

    shared/             # Types and protocols shared across all packages
      src/
        types.ts        # Message formats, channel configs, skill manifests
        protocol.ts     # Relay protocol (extension ↔ server)
      package.json

  package.json          # Root workspace config
  turbo.json            # or nx.json for task orchestration
```

### Why monorepo

- **Shared types**: The relay protocol between extension and server needs to stay in sync. One PR changes both sides.
- **Lockstep versioning**: Server and extension evolve together, no version drift.
- **Single CI**: One pipeline tests everything.
- **Easier to develop**: `npm run dev` starts extension + server + web together.

### Runtime choices

**Server**: Deno is the preference (familiar, good sandbox infrastructure, built-in TypeScript, easy deployment). But the architecture shouldn't lock us in — use standard HTTP/fetch patterns so it can also run on Node/Cloudflare Workers/Fly.io.

**Extension**: Stays as-is (Vite + @crxjs/vite-plugin).

**Web**: Static site or lightweight framework (could be Vite + vanilla, or Astro for content-heavy pages).

### Migration path

Phase 0 (before implementing channels):
1. Create `packages/` directory structure
2. Move current extension code into `packages/extension/`
3. Set up workspace (npm workspaces or pnpm)
4. Verify extension still builds and tests pass
5. Create `packages/shared/` with types extracted from extension

Phase 1 (with channels):
1. Create `packages/server/` with the relay server
2. Import shared types
3. Deploy server (Deno Deploy initially)
4. Extension polls server for messages

Phase 2 (website):
1. Create `packages/web/`
2. Public landing page, docs
3. Skill marketplace browser (reads from server's registry API)

### Deployment

- **Extension**: Built locally or in CI, distributed via Chrome Web Store (or as .crx/.zip)
- **Server**: Deployed to Deno Deploy (or any platform supporting Deno/Node). Could also be self-hosted for privacy.
- **Web**: Static hosting (GitHub Pages, Netlify, Cloudflare Pages)

Each package deploys independently but shares the same codebase and types.

## Related

- [emaila.gent](https://github.com/PaulKinlan/emaila.gent) - email-based agent communication pattern
- [docker-agent-test](https://github.com/PaulKinlan/docker-agent-test) - inter-agent communication via email protocol
- [utter](https://github.com/PaulKinlan/utter) - voice input channel pattern
