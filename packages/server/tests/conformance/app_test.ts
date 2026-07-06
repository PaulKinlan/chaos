// End-to-end: the per-user admin app flow — mint a device link (signed), redeem
// it for a browser session, add a channel, see it listed with secrets masked,
// and confirm the link is single-use. Run against a live server:
//   RELAY_URL=http://localhost:8787 deno test --allow-all tests/conformance/app_test.ts
import { assert, assertEquals } from "jsr:@std/assert";
import { authedFetch, getBaseUrl, register } from "./helpers.ts";

Deno.test("admin app: device-link -> session -> add webhook -> list", async () => {
  const base = getBaseUrl();
  const creds = await register();

  // 1. Mint a device link with a signed request.
  const mint = await authedFetch(
    `${base}/app/device-link`,
    { method: "POST", body: "{}" },
    creds,
  );
  assertEquals(mint.status, 200);
  const link = await mint.json();
  assert(typeof link.token === "string" && link.token.length > 0);
  assert(String(link.url).includes("/app?token="));

  // 2. Redeem it (no signing — just the one-time token) for an app session.
  const redeem = await fetch(`${base}/app/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: link.token }),
  });
  assertEquals(redeem.status, 200);
  const { sessionToken } = await redeem.json();

  const app = (path: string, opts: RequestInit = {}) =>
    fetch(`${base}/app/api${path}`, {
      ...opts,
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

  // 3. Add a webhook channel (needs no external service).
  const add = await app("/channels", {
    method: "POST",
    body: JSON.stringify({ type: "webhook", name: "test hook" }),
  });
  assertEquals(add.status, 201);
  const added = await add.json();
  assertEquals(added.channel.type, "webhook");
  assert(String(added.webhookUrl).includes("/webhook/"));

  // 4. It lists, with the secret masked.
  const list = await (await app("/channels")).json();
  const hook = list.find((c: { type: string; name: string }) =>
    c.type === "webhook" && c.name === "test hook"
  );
  assert(hook, "added webhook should appear in the list");
  assertEquals(hook.metadata.webhookSecret, "••••••••");

  // 5. The device link is single-use: a second redeem fails.
  const reuse = await fetch(`${base}/app/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: link.token }),
  });
  assertEquals(reuse.status, 401);

  // 6. Delete it to leave state clean.
  assertEquals(
    (await app(`/channels/${hook.id}`, { method: "DELETE" })).status,
    200,
  );
});
