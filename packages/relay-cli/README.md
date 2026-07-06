# chaos-relay-server

A thin `npx` launcher for the [CHAOS](https://github.com/PaulKinlan/chaos) relay
server. It runs the Deno server published to JSR — no build step.

```bash
npx chaos-relay-server
```

Requires [Deno](https://deno.com/) on your PATH. All arguments and environment
variables are passed straight through to the server, so configure it the same way
as a direct run (see [self-hosting docs](https://github.com/PaulKinlan/chaos/blob/main/docs/relay-self-hosting.md)):

```bash
CHAOS_KV_PATH=/var/lib/chaos/kv.sqlite \
CHAOS_ADMIN_KEY=my-secret \
PORT=8787 \
npx chaos-relay-server
```

Under the hood this is just `deno run -A --unstable-kv jsr:@paulkinlan/chaos-relay@<version>`.
The npm version tracks the relay release, so `chaos-relay-server@X.Y.Z` runs relay
`X.Y.Z`. For a container or Cloud Run deployment instead, use the
[Docker image](https://github.com/PaulKinlan/chaos/blob/main/packages/server/Dockerfile).
