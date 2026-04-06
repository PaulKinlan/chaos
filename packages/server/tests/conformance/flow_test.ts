// Conformance tests: End-to-end flow
// Full lifecycle: register, create channel, send webhook, poll, reply, check responses.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authedFetch, getBaseUrl, register } from "./helpers.ts";

const base = getBaseUrl();

Deno.test("Full end-to-end: register -> create channel -> webhook -> poll -> reply -> responses", async () => {
  // 1. Register a new session
  const creds = await register();
  assertExists(creds.userId);
  assertExists(creds.apiKey);

  // 2. Create a webhook channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook", direction: "bidirectional" }),
    },
    creds,
  );
  assertEquals(createResp.status, 201);
  const { channel, webhookUrl } = await createResp.json();
  assertExists(channel.id);
  assertExists(webhookUrl);

  const sinceBeforeWebhook = new Date().toISOString();

  // 3. Send a message via webhook
  const webhookResp = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Source": "conformance-test",
    },
    body: JSON.stringify({ text: "hello from e2e test" }),
  });
  assertEquals(webhookResp.status, 200);
  const { messageId } = await webhookResp.json();
  assertExists(messageId);

  // 4. Poll for the message
  const pollResp = await authedFetch(
    `${base}/messages?since=${sinceBeforeWebhook}`,
    { method: "GET" },
    creds,
  );
  assertEquals(pollResp.status, 200);
  const pollData = await pollResp.json();
  assertEquals(pollData.messages.length >= 1, true, "should have the webhook message");

  const incomingMsg = pollData.messages.find(
    (m: { id: string }) => m.id === messageId,
  );
  assertExists(incomingMsg, "should find the specific message by id");
  assertEquals(incomingMsg.from, "conformance-test");
  assertEquals(incomingMsg.channelType, "webhook");
  assertEquals(incomingMsg.channelId, channel.id);

  // 5. Send a reply
  const replyResp = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "webhook",
        channelId: channel.id,
        replyTo: messageId,
        content: "reply from agent",
      }),
    },
    creds,
  );
  assertEquals(replyResp.status, 200);
  const replyData = await replyResp.json();
  assertEquals(replyData.ok, true);
  assertExists(replyData.responseId);

  // 6. Poll for responses on the channel
  const responsesResp = await fetch(
    `${base}/responses/${channel.id}`,
  );
  assertEquals(responsesResp.status, 200);
  const responsesData = await responsesResp.json();
  assertExists(responsesData.responses);
  assertEquals(
    responsesData.responses.length >= 1,
    true,
    "should have at least one response",
  );

  const agentReply = responsesData.responses.find(
    (r: { id: string }) => r.id === replyData.responseId,
  );
  assertExists(agentReply, "should find the agent reply");
  assertEquals(agentReply.content, "reply from agent");
  assertEquals(agentReply.from, "agent");
  assertEquals(agentReply.channelId, channel.id);
});

Deno.test("Multiple webhooks are returned in order", async () => {
  const creds = await register();
  const sinceStart = new Date().toISOString();

  // Create channel
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

  // Send 3 webhooks in sequence
  for (let i = 0; i < 3; i++) {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `message ${i}` }),
    });
    assertEquals(resp.status, 200);
    await resp.body?.cancel();
  }

  // Poll and verify order
  const pollResp = await authedFetch(
    `${base}/messages?since=${sinceStart}`,
    { method: "GET" },
    creds,
  );
  const pollData = await pollResp.json();
  assertEquals(pollData.messages.length >= 3, true, "should have all 3 messages");

  // Messages should be in chronological order
  for (let i = 1; i < pollData.messages.length; i++) {
    const prev = new Date(pollData.messages[i - 1].timestamp).getTime();
    const curr = new Date(pollData.messages[i].timestamp).getTime();
    assertEquals(
      prev <= curr,
      true,
      `message ${i - 1} should be before message ${i}`,
    );
  }
});

Deno.test("Responses endpoint with since filter", async () => {
  const creds = await register();

  // Create channel
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

  // Send a reply
  await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "webhook",
        channelId: channel.id,
        content: "first reply",
      }),
    },
    creds,
  );

  // Get responses and note the since timestamp
  const resp1 = await fetch(`${base}/responses/${channel.id}`);
  const data1 = await resp1.json();
  const since = data1.since;
  assertExists(since);

  // Send another reply
  await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "webhook",
        channelId: channel.id,
        content: "second reply",
      }),
    },
    creds,
  );

  // Poll with since — should only get the second reply
  const resp2 = await fetch(`${base}/responses/${channel.id}?since=${since}`);
  const data2 = await resp2.json();
  assertEquals(data2.responses.length >= 1, true);

  const hasSecond = data2.responses.some(
    (r: { content: string }) => r.content === "second reply",
  );
  assertEquals(hasSecond, true, "should include the second reply");
});

Deno.test("Reply with missing fields returns 400", async () => {
  const creds = await register();

  // Missing channelId
  const resp1 = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test" }),
    },
    creds,
  );
  assertEquals(resp1.status, 400);
  await resp1.body?.cancel();

  // Missing content
  const resp2 = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: "abc" }),
    },
    creds,
  );
  assertEquals(resp2.status, 400);
  await resp2.body?.cancel();
});

Deno.test("Unknown route returns 404", async () => {
  const creds = await register();
  const resp = await authedFetch(
    `${base}/nonexistent-route`,
    { method: "GET" },
    creds,
  );
  assertEquals(resp.status, 404);
  await resp.body?.cancel();
});
