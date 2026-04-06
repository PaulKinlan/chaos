// Conformance tests: Authentication and registration
// Verifies registration, session reclaim, and auth rejection behaviour.

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authedFetch,
  generateKeyPair,
  getBaseUrl,
  hashBody,
  register,
  registerLegacy,
  signRequest,
} from "./helpers.ts";

const base = getBaseUrl();

Deno.test("Registration with public key returns userId, apiKey, and serverPublicKey", async () => {
  const keyPair = await generateKeyPair();
  const resp = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyPair.publicKeyJwk }),
  });

  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertExists(data.userId, "should return userId");
  assertExists(data.apiKey, "should return apiKey");
  assertExists(data.serverPublicKey, "should return serverPublicKey");
  assertEquals(typeof data.userId, "string");
  assertEquals(typeof data.apiKey, "string");
});

Deno.test("Registration without public key works (legacy)", async () => {
  const resp = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertExists(data.userId);
  assertExists(data.apiKey);
});

Deno.test("Same public key reclaims existing session", async () => {
  const keyPair = await generateKeyPair();

  // First registration
  const resp1 = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyPair.publicKeyJwk }),
  });
  assertEquals(resp1.status, 200);
  const data1 = await resp1.json();

  // Second registration with the same key
  const resp2 = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyPair.publicKeyJwk }),
  });
  assertEquals(resp2.status, 200);
  const data2 = await resp2.json();

  // Should get the same userId back
  assertEquals(
    data2.userId,
    data1.userId,
    "same public key should reclaim the same userId",
  );
  assertEquals(
    data2.apiKey,
    data1.apiKey,
    "same public key should reclaim the same apiKey",
  );
});

Deno.test("Invalid Bearer token returns 401 on authenticated endpoint", async () => {
  const resp = await fetch(`${base}/channels`, {
    headers: { Authorization: "Bearer invalid-token-that-does-not-exist" },
  });
  assertEquals(resp.status, 401);
  const data = await resp.json();
  assertExists(data.error);
});

Deno.test("Missing Authorization header returns 401 on authenticated endpoint", async () => {
  const resp = await fetch(`${base}/channels`);
  assertEquals(resp.status, 401);
  const data = await resp.json();
  assertExists(data.error);
});

Deno.test("Signed session requires signature headers — missing headers rejected", async () => {
  // Register with a public key
  const keyPair = await generateKeyPair();
  const regResp = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyPair.publicKeyJwk }),
  });
  const { apiKey } = await regResp.json();

  // Try to access an authenticated endpoint with only Bearer (no signature headers)
  const resp = await fetch(`${base}/channels`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assertEquals(
    resp.status,
    401,
    "session with public key must include signature headers",
  );
  await resp.body?.cancel();
});

Deno.test("Stale timestamp rejected", async () => {
  const creds = await register();
  const path = "/channels";
  // Timestamp from 10 minutes ago (server allows 5 min window)
  const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const nonce = crypto.randomUUID();
  const bodyHashHex = await hashBody("");
  const signature = await signRequest(
    creds.privateKey,
    staleTimestamp,
    nonce,
    path,
    bodyHashHex,
  );

  const resp = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "X-Timestamp": staleTimestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
  });

  assertEquals(resp.status, 401, "stale timestamp should be rejected");
  await resp.body?.cancel();
});

Deno.test("Replayed nonce rejected", async () => {
  const creds = await register();
  const path = "/channels";
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyHashHex = await hashBody("");
  const signature = await signRequest(
    creds.privateKey,
    timestamp,
    nonce,
    path,
    bodyHashHex,
  );

  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": signature,
  };

  // First request should succeed
  const resp1 = await fetch(`${base}${path}`, { headers });
  assertEquals(resp1.status, 200, "first request should succeed");
  await resp1.body?.cancel();

  // Second request with same nonce should be rejected
  // Need a fresh timestamp but keep the same nonce
  const timestamp2 = new Date().toISOString();
  const signature2 = await signRequest(
    creds.privateKey,
    timestamp2,
    nonce,
    path,
    bodyHashHex,
  );

  const resp2 = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "X-Timestamp": timestamp2,
      "X-Nonce": nonce,
      "X-Signature": signature2,
    },
  });
  assertEquals(resp2.status, 401, "replayed nonce should be rejected");
  await resp2.body?.cancel();
});

Deno.test("Legacy session (no public key) can access endpoints without signatures", async () => {
  const { apiKey } = await registerLegacy();
  const resp = await fetch(`${base}/channels`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertExists(data.channels, "should return channels array");
});

Deno.test("Different public keys produce different sessions", async () => {
  const kp1 = await generateKeyPair();
  const kp2 = await generateKeyPair();

  const resp1 = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp1.publicKeyJwk }),
  });
  const data1 = await resp1.json();

  const resp2 = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp2.publicKeyJwk }),
  });
  const data2 = await resp2.json();

  assertNotEquals(data1.userId, data2.userId);
  assertNotEquals(data1.apiKey, data2.apiKey);
});
