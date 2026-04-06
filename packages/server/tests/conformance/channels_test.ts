// Conformance tests: Channel CRUD and webhook ingestion
// Verifies channel creation, listing, update, deletion, webhook POST, and message polling.

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authedFetch, getBaseUrl, register } from "./helpers.ts";

const base = getBaseUrl();

Deno.test("Create a webhook channel", async () => {
  const creds = await register();

  const resp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );

  assertEquals(resp.status, 201);
  const data = await resp.json();
  assertExists(data.channel, "should return channel object");
  assertExists(data.channel.id, "channel should have an id");
  assertEquals(data.channel.type, "webhook");
  assertEquals(data.channel.enabled, true);
  assertExists(data.webhookUrl, "should return a webhookUrl for webhook channels");
  // webhookUrl should contain the channel id and a token
  assertEquals(
    data.webhookUrl.includes(data.channel.id),
    true,
    "webhookUrl should contain the channel id",
  );
});

Deno.test("Create a webhook channel with custom metadata", async () => {
  const creds = await register();

  const resp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        metadata: { source: "github" },
      }),
    },
    creds,
  );

  assertEquals(resp.status, 201);
  const data = await resp.json();
  assertEquals(data.channel.type, "webhook");
  // Webhook channels always get a webhookSecret even if not provided
  assertExists(data.channel.metadata.webhookSecret);
});

Deno.test("List channels returns empty array for new session", async () => {
  const creds = await register();

  const resp = await authedFetch(`${base}/channels`, { method: "GET" }, creds);

  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertExists(data.channels);
  assertEquals(Array.isArray(data.channels), true);
  assertEquals(data.channels.length, 0);
});

Deno.test("List channels returns created channels", async () => {
  const creds = await register();

  // Create two channels
  const c1 = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  await c1.body?.cancel();
  const c2 = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  await c2.body?.cancel();

  const resp = await authedFetch(`${base}/channels`, { method: "GET" }, creds);
  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertEquals(data.channels.length, 2);
});

Deno.test("Update channel metadata via PATCH", async () => {
  const creds = await register();

  // Create a channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { channel } = await createResp.json();

  // PATCH the channel
  const patchResp = await authedFetch(
    `${base}/channels/${channel.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My Webhook",
        metadata: { allowedUsers: ["user1", "user2"] },
      }),
    },
    creds,
  );

  assertEquals(patchResp.status, 200);
  const patchData = await patchResp.json();
  assertEquals(patchData.ok, true);
  assertEquals(patchData.channel.name, "My Webhook");
  assertEquals(patchData.channel.metadata.allowedUsers, ["user1", "user2"]);
});

Deno.test("PATCH non-existent channel returns 404", async () => {
  const creds = await register();

  const resp = await authedFetch(
    `${base}/channels/nonexistent-channel-id`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    },
    creds,
  );

  assertEquals(resp.status, 404);
  await resp.body?.cancel();
});

Deno.test("Delete a channel", async () => {
  const creds = await register();

  // Create a channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { channel } = await createResp.json();

  // Delete it
  const deleteResp = await authedFetch(
    `${base}/channels/${channel.id}`,
    { method: "DELETE", body: null },
    creds,
  );

  assertEquals(deleteResp.status, 200);
  const deleteData = await deleteResp.json();
  assertEquals(deleteData.ok, true);

  // Verify it's gone
  const listResp = await authedFetch(
    `${base}/channels`,
    { method: "GET" },
    creds,
  );
  const listData = await listResp.json();
  assertEquals(listData.channels.length, 0);
});

Deno.test("Delete non-existent channel returns 404", async () => {
  const creds = await register();

  const resp = await authedFetch(
    `${base}/channels/nonexistent-channel-id`,
    { method: "DELETE", body: null },
    creds,
  );

  assertEquals(resp.status, 404);
  await resp.body?.cancel();
});

Deno.test("Webhook ingestion stores a message", async () => {
  const creds = await register();

  // Create a webhook channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { channel, webhookUrl } = await createResp.json();
  assertExists(webhookUrl);

  // Send a webhook
  const webhookResp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "hello from webhook" }),
  });

  assertEquals(webhookResp.status, 200);
  const webhookData = await webhookResp.json();
  assertEquals(webhookData.ok, true);
  assertExists(webhookData.messageId);
});

Deno.test("Webhook with invalid token is rejected", async () => {
  const creds = await register();

  // Create a webhook channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { channel } = await createResp.json();

  // Send a webhook with a wrong token
  const resp = await fetch(
    `${base}/webhook/${channel.id}?token=wrong-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "should fail" }),
    },
  );

  assertEquals(resp.status, 401);
  await resp.body?.cancel();
});

Deno.test("Webhook to unknown channel returns 404", async () => {
  const resp = await fetch(
    `${base}/webhook/nonexistent-channel-id?token=abc`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "should fail" }),
    },
  );

  assertEquals(resp.status, 404);
  await resp.body?.cancel();
});

Deno.test("Poll messages after webhook returns the message", async () => {
  const creds = await register();
  const sinceBeforeCreate = new Date().toISOString();

  // Create a webhook channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { webhookUrl } = await createResp.json();

  // Send a webhook message
  const whResp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "poll test message" }),
  });
  await whResp.body?.cancel();

  // Poll for messages
  const pollResp = await authedFetch(
    `${base}/messages?since=${sinceBeforeCreate}`,
    { method: "GET" },
    creds,
  );

  assertEquals(pollResp.status, 200);
  const pollData = await pollResp.json();
  assertExists(pollData.messages);
  assertEquals(Array.isArray(pollData.messages), true);
  assertEquals(pollData.messages.length >= 1, true, "should have at least one message");
  assertExists(pollData.since, "should return a since timestamp for next poll");

  // Verify the message content
  const msg = pollData.messages.find((m: { content: string }) =>
    m.content.includes("poll test message")
  );
  assertExists(msg, "should find the webhook message in poll results");
  assertEquals(msg.channelType, "webhook");
  assertEquals(msg.from, "webhook");
});

Deno.test("Poll messages with no since returns all messages", async () => {
  const creds = await register();

  // Create and send
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { webhookUrl } = await createResp.json();

  const whResp2 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "no-since test" }),
  });
  await whResp2.body?.cancel();

  // Poll without since
  const pollResp = await authedFetch(
    `${base}/messages`,
    { method: "GET" },
    creds,
  );

  assertEquals(pollResp.status, 200);
  const pollData = await pollResp.json();
  assertEquals(pollData.messages.length >= 1, true);
});

Deno.test("Channels are isolated between sessions", async () => {
  const creds1 = await register();
  const creds2 = await register();

  // Create a channel in session 1
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds1,
  );
  await createResp.body?.cancel();

  // Session 2 should see no channels
  const resp = await authedFetch(`${base}/channels`, { method: "GET" }, creds2);
  const data = await resp.json();
  assertEquals(data.channels.length, 0, "session 2 should not see session 1 channels");
});
