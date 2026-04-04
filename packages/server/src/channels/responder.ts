// Response delivery handler
// When the extension sends a reply, route it to the appropriate channel

import { addResponse, type StoredMessage } from "../store.ts";
import { getSessionByUserId } from "../auth.ts";
import { sendTelegramReply } from "./telegram.ts";
import { logger } from "../logger.ts";

export interface ReplyPayload {
  channelType: string;
  channelId: string;
  replyTo?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export async function handleReply(
  userId: string,
  payload: ReplyPayload,
): Promise<{ ok: boolean; responseId: string }> {
  const response: StoredMessage = {
    id: crypto.randomUUID(),
    userId,
    channelType: payload.channelType,
    channelId: payload.channelId,
    from: "agent",
    content: payload.content,
    timestamp: new Date().toISOString(),
    metadata: {
      ...payload.metadata,
      replyTo: payload.replyTo,
    },
  };

  // Store the response for polling
  await addResponse(payload.channelId, response);

  logger.info("responder", "Outgoing reply stored", {
    userId,
    channelId: payload.channelId,
    channelType: payload.channelType,
    responseId: response.id,
  });

  // For Telegram channels, also send the reply immediately via Telegram API
  if (payload.channelType === "telegram") {
    sendTelegramReplyAsync(userId, payload);
  }

  return { ok: true, responseId: response.id };
}

async function sendTelegramReplyAsync(
  userId: string,
  payload: ReplyPayload,
): Promise<void> {
  try {
    const session = await getSessionByUserId(userId);
    if (!session) return;

    const channel = session.channels.find((ch) => ch.id === payload.channelId);
    if (!channel || channel.type !== "telegram") return;

    // Use plaintext token if available (in-memory), otherwise decrypt
    let botToken = channel.metadata["botTokenPlain"] as string | undefined;
    if (!botToken) {
      const encrypted = channel.metadata["botToken"] as string | undefined;
      if (encrypted) {
        const { decryptToken } = await import("../crypto.ts");
        botToken = await decryptToken(encrypted);
      }
    }
    const chatId = payload.metadata?.["chatId"] as string | number | undefined;

    if (!botToken || !chatId) {
      logger.error("responder", "Telegram reply missing botToken or chatId", {
        userId,
        channelId: payload.channelId,
      });
      return;
    }

    await sendTelegramReply(botToken, chatId, payload.content);
  } catch (err) {
    logger.error("responder", "Failed to send Telegram reply", {
      userId,
      channelId: payload.channelId,
      error: String(err),
    });
  }
}
