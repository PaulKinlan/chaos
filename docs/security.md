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

### Relay Server Auth
- The extension authenticates to the relay server using a per-installation API key
- API keys are generated during the channel setup flow and stored locally
- The relay server validates the API key on every request

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
