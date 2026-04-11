# Self-Hosting the CHAOS Relay Server

The relay server bridges external channels (Telegram, Discord, email, webhooks) to the CHAOS Chrome extension. You can self-host it instead of using the default relay at chaos-relay.com.

## Prerequisites

- [Deno](https://deno.land/) v2.x or later
- A domain name (for HTTPS/WSS)
- Optional: Telegram Bot Token, Discord Bot Token, Resend API key

## Quick Start (Local)

```bash
cd packages/server

# Set the admin password
export CHAOS_ADMIN_KEY=your-admin-password

# Start the server
deno task dev
# Server runs at http://localhost:8787
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CHAOS_ADMIN_KEY` | Yes | Password for the admin dashboard |
| `PORT` | No | Server port (default: 8787, ignored on Deno Deploy) |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |
| `LOG_FORMAT` | No | `pretty` (default) or `json` |
| `RESEND_API_KEY` | No | Resend API key for email channels |
| `RESEND_WEBHOOK_SECRET` | No | Svix secret for verifying Resend webhooks |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for validating Telegram webhook URLs |

## Deploy to Deno Deploy

1. Push the repo to GitHub
2. Go to [dash.deno.com](https://dash.deno.com) and create a new project
3. Link to your GitHub repo, entry point: `packages/server/src/main.ts`
4. Set environment variables in the project settings
5. Deploy

The server uses Deno KV automatically on Deno Deploy (no configuration needed).

## Deploy with Docker

```dockerfile
FROM denoland/deno:2.0.0

WORKDIR /app
COPY packages/server/ ./packages/server/
COPY packages/shared/ ./packages/shared/

EXPOSE 8787

ENV PORT=8787
CMD ["deno", "run", "--allow-net", "--allow-env", "--unstable-kv", "packages/server/src/main.ts"]
```

```bash
docker build -t chaos-relay .
docker run -p 8787:8787 -e CHAOS_ADMIN_KEY=secret chaos-relay
```

## Connect the Extension

1. Open the CHAOS extension
2. Go to Channels tab
3. Enter your relay server URL (e.g., `https://relay.yourdomain.com`)
4. Click Connect

The extension will register with your relay server and establish a WebSocket connection for real-time message delivery.

## Admin Dashboard

Access at `https://your-relay-url/admin`. Log in with `CHAOS_ADMIN_KEY`.

Features:
- Session overview (connected clients, channels)
- Recent messages
- KV browser for debugging
- Session management (delete sessions)

## Channel Setup

### Webhooks
Any HTTP client can POST to `https://your-relay-url/webhook/{channelId}?token={secret}`.

### Telegram
1. Create a bot via @BotFather
2. Add the bot token in the extension's channel setup
3. The relay registers a webhook with Telegram automatically

### Discord
1. Create a Discord bot and get its token
2. Add the token in the extension's channel setup
3. The relay connects to Discord's gateway

### Email (Resend)
1. Set `RESEND_API_KEY` on the server
2. Configure a Resend inbound webhook pointing to `https://your-relay-url/email/inbound`
3. Add an email channel in the extension

## Security

- All client-server communication uses ECDSA P-256 request signing
- WebSocket connections authenticated via API key
- Admin dashboard uses session cookies with 24h TTL
- Optional: Resend webhook signature verification via Svix
