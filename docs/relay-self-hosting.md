# Self-Hosting the CHAOS Relay Server

The CHAOS relay server bridges external services (Telegram, Discord, Email, webhooks) to the CHAOS Chrome extension. You can run your own relay instead of using the hosted default.

## Prerequisites

- [Deno](https://deno.com/) v1.40+ (for native Deno KV support)
- A domain name with TLS (required for Telegram/Discord webhooks)
- Optional: Docker for containerized deployment

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8787` | HTTP port the server listens on |
| `CHAOS_ADMIN_KEY` | No | -- | Password for the admin dashboard at `/admin`. If not set, admin endpoints return 503. |
| `CHAOS_ENCRYPTION_KEY` | No | auto-generated | AES key for encrypting sensitive data (bot tokens) in KV. If not set, one is derived automatically. Set this explicitly when running multiple instances to ensure they can decrypt each other's data. |
| `CHAOS_EMAIL_DOMAIN` | No | -- | Domain for inbound email addresses (e.g., `relay.example.com`). Required only if you want email channels. |
| `RESEND_API_KEY` | No | -- | [Resend](https://resend.com/) API key for sending email replies and verification emails. Required for email channels. |
| `RESEND_WEBHOOK_SECRET` | No | -- | Webhook signing secret from Resend, used to verify inbound email webhooks. |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | No | `pretty` | Log output format: `pretty` (human-readable) or `json` (structured) |
| `DENO_DEPLOYMENT_ID` | No | -- | Set automatically on Deno Deploy. When present, the server omits the port option (Deno Deploy manages the listener). |

## Running Locally

Clone the repository and start the server:

```bash
git clone https://github.com/nichochar/chaos.git
cd chaos/packages/server

# Development mode (auto-reload on file changes)
deno task dev

# Production mode
deno task start
```

The server starts on `http://localhost:8787` by default. Test it:

```bash
curl http://localhost:8787/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "kv": true,
  "websockets": 0,
  "uptime": 5
}
```

### With Environment Variables

```bash
CHAOS_ADMIN_KEY=my-secret-password \
LOG_LEVEL=debug \
deno task start
```

Then visit `http://localhost:8787/admin` to access the admin dashboard.

### Running Tests

```bash
# Unit tests
deno task test

# Conformance tests against a running server
deno task test:conformance --url http://localhost:8787
```

## Deploying to Deno Deploy

The relay is designed for [Deno Deploy](https://deno.com/deploy), which provides built-in Deno KV, global edge deployment, and automatic TLS.

1. Push your fork to GitHub
2. Go to [dash.deno.com](https://dash.deno.com/) and create a new project
3. Link it to your GitHub repository
4. Set the entry point to `packages/server/src/main.ts`
5. Add environment variables in the project settings:
   - `CHAOS_ADMIN_KEY` -- your admin password
   - `CHAOS_ENCRYPTION_KEY` -- a strong random string (generate with `openssl rand -hex 32`)
   - Email variables if needed: `CHAOS_EMAIL_DOMAIN`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
6. Deploy

Deno Deploy provides:
- **Deno KV** -- persistent key-value storage, no external database needed
- **kv.watch()** -- real-time change notifications across isolates (powers WebSocket message push)
- **Automatic TLS** -- required for Telegram/Discord webhook callbacks
- **Global edge** -- low latency worldwide

## Deploying with Docker

Create a `Dockerfile` in the repository root:

```dockerfile
FROM denoland/deno:latest

WORKDIR /app

# Copy source
COPY packages/server/ ./packages/server/
COPY packages/shared/ ./packages/shared/

WORKDIR /app/packages/server

# Cache dependencies
RUN deno cache src/main.ts

# Deno KV uses SQLite locally -- data persists in /app/data
ENV DENO_KV_PATH=/app/data/kv.sqlite

EXPOSE 8787

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "--unstable-kv", "src/main.ts"]
```

Build and run:

```bash
docker build -t chaos-relay .
docker run -d \
  -p 8787:8787 \
  -v chaos-relay-data:/app/data \
  -e CHAOS_ADMIN_KEY=my-secret \
  -e CHAOS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  chaos-relay
```

### Docker Compose

```yaml
version: "3.8"
services:
  relay:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - relay-data:/app/data
    environment:
      - CHAOS_ADMIN_KEY=${CHAOS_ADMIN_KEY}
      - CHAOS_ENCRYPTION_KEY=${CHAOS_ENCRYPTION_KEY}
      - LOG_LEVEL=info
      - LOG_FORMAT=json
    restart: unless-stopped

volumes:
  relay-data:
```

## Deploying to Fly.io

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/)
2. Create a `fly.toml`:

```toml
app = "chaos-relay"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  LOG_LEVEL = "info"
  LOG_FORMAT = "json"

[http_service]
  internal_port = 8787
  force_https = true

[mounts]
  source = "relay_data"
  destination = "/app/data"
```

3. Deploy:

```bash
fly launch
fly secrets set CHAOS_ADMIN_KEY=my-secret
fly secrets set CHAOS_ENCRYPTION_KEY=$(openssl rand -hex 32)
fly deploy
```

## Deploying to Other Platforms

The relay server works on any platform that supports Deno. Key requirements:

- **Deno runtime** with `--unstable-kv` flag
- **Persistent storage** for Deno KV (SQLite-backed locally, managed on Deno Deploy)
- **TLS termination** (required for Telegram/Discord webhooks)
- **WebSocket support** (for real-time message delivery)

For platforms like Railway, Render, or a plain VPS:

1. Install Deno on the host
2. Clone the repo and set environment variables
3. Run `deno run --allow-net --allow-read --allow-env --unstable-kv packages/server/src/main.ts`
4. Set up a reverse proxy (nginx, Caddy) for TLS termination

### Reverse Proxy (Caddy)

```
relay.example.com {
    reverse_proxy localhost:8787
}
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

The `Upgrade` and `Connection` headers are required for WebSocket support.

## Connecting the Extension

Once your relay is running:

1. Open CHAOS in Chrome
2. Go to the **Channels** view
3. Enter your relay server URL (e.g., `https://relay.example.com`)
4. Click **Connect**

The extension will register a session with your relay and begin using it for all channel communication. You can verify the connection by checking the relay's `/health` endpoint or admin dashboard.

## Admin Dashboard

Access at `https://your-relay-url/admin`. Log in with `CHAOS_ADMIN_KEY`.

Features:
- Server status overview (uptime, KV health, WebSocket connections)
- Active sessions with their channels
- Recent messages (last 30, with direction and content preview)
- Session management (delete sessions and all associated channels)

## Monitoring

- **Health check**: `GET /health` returns server status, KV availability, WebSocket count, and uptime
- **Admin dashboard**: Visit `/admin` (requires `CHAOS_ADMIN_KEY`) to see active sessions, channels, and recent messages
- **Logs**: Set `LOG_FORMAT=json` for structured logging, pipe to your log aggregation system

## Security Considerations

- Always use TLS in production -- bot tokens and API keys transit through the relay
- Set `CHAOS_ENCRYPTION_KEY` explicitly so bot tokens are encrypted at rest in KV
- Use `CHAOS_ADMIN_KEY` with a strong password to protect the admin dashboard
- The relay uses ECDSA P-256 request signing for tamper-proof authenticated requests
- Rate limiting is enforced per-endpoint -- see the [API specification](relay-api-spec.md) for limits
- Admin cookies are HttpOnly, SameSite=Strict with 24-hour TTL
