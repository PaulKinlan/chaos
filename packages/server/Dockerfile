# CHAOS relay server — container image for long-lived hosts (VPS, Cloud Run, etc.)
# where WebSocket connections persist (unlike serverless isolates).
#
# Build from the REPO ROOT (the server imports ../shared):
#   docker build -f packages/server/Dockerfile -t chaos-relay .
# Run with a persistent volume so the Deno KV SQLite file survives restarts:
#   docker run -p 8787:8787 -v chaos-kv:/data chaos-relay
#
# Pin the base image to a specific Deno version in production instead of :latest.
FROM denoland/deno:latest

WORKDIR /app

# Copy the shared types the server import-maps to, then the server itself.
COPY packages/shared /app/packages/shared
COPY packages/server /app/packages/server

WORKDIR /app/packages/server

# Warm the module cache at build time so startup is fast.
RUN deno cache src/main.ts

# Persist Deno KV to a mounted volume. On Deno Deploy this var is unset and the
# managed KV is used instead; here we point it at /data (see VOLUME below).
ENV CHAOS_KV_PATH=/data/kv.sqlite
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

# `deno task start` already carries the right flags (net/read/write/env/unstable-kv).
CMD ["deno", "task", "start"]
