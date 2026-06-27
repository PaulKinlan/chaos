// Generic webhook channel handler
// Receives HTTP webhooks from external services and stores them as messages

import { addMessage, type StoredMessage } from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { logger } from "../logger.ts";

export async function handleWebhook(
  channelId: string,
  req: Request,
): Promise<Response> {
  logger.info("webhook", "Incoming webhook", { channelId });

  // Look up the channel owner
  const session = await getSessionByChannelId(channelId);
  if (!session) {
    logger.error("webhook", "Unknown channel", { channelId });
    return new Response(JSON.stringify({ error: "Unknown channel" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Find the channel config to verify it's a webhook type
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "webhook") {
    logger.error("webhook", "Channel is not a webhook type", { channelId });
    return new Response(JSON.stringify({ error: "Channel is not a webhook" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the secret token from query params
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expectedToken = channel.metadata?.["webhookSecret"] as
    | string
    | undefined;
  if (expectedToken && token !== expectedToken) {
    logger.error("webhook", "Invalid webhook token", { channelId });
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse the payload
  let content: string;
  let metadata: Record<string, unknown> = {};
  const contentType = req.headers.get("Content-Type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      content = typeof body === "string" ? body : JSON.stringify(body);
      metadata = { raw: body };
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      const entries: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        entries[key] = String(value);
      }
      content = JSON.stringify(entries);
      metadata = { form: entries };
    } else {
      content = await req.text();
      metadata = { raw: content };
    }
  } catch (err) {
    logger.error("webhook", "Failed to parse webhook body", {
      channelId,
      error: String(err),
    });
    content = await req.text().catch(() => "(empty body)");
  }

  // Include channel config for client-side processing
  metadata.channelDirection = channel.direction || "inbound";
  if (channel.name) metadata.channelName = channel.name;
  if (channel.prompt) metadata.channelPrompt = channel.prompt;
  if (channel.agentId) metadata.channelAgentId = channel.agentId;
  if (channel.runInBackground) metadata.channelRunInBackground = true;
  if (channel.notifyOnComplete !== undefined) {
    metadata.channelNotifyOnComplete = channel.notifyOnComplete;
  }

  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: "webhook",
    channelId,
    from: req.headers.get("X-Webhook-Source") || "webhook",
    content,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await addMessage(session.userId, message);

  logger.info("webhook", "Webhook message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from: message.from,
  });

  return new Response(JSON.stringify({ ok: true, messageId: message.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
