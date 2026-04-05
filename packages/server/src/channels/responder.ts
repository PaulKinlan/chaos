// Response delivery handler
// When the extension sends a reply, route it to the appropriate channel

import { addResponse, type StoredMessage } from "../store.ts";
import { getSessionByUserId } from "../auth.ts";
import { sendTelegramReply } from "./telegram.ts";
import { sendDiscordReply } from "./discord.ts";
import { sendEmailReply } from "./email.ts";
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

  // For Discord channels, also send the reply immediately via Discord API
  if (payload.channelType === "discord") {
    sendDiscordReplyAsync(userId, payload);
  }

  // For Email channels, send the reply immediately via Resend API
  if (payload.channelType === "email") {
    sendEmailReplyAsync(userId, payload);
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

async function sendDiscordReplyAsync(
  userId: string,
  payload: ReplyPayload,
): Promise<void> {
  try {
    const session = await getSessionByUserId(userId);
    if (!session) return;

    const channel = session.channels.find((ch) => ch.id === payload.channelId);
    if (!channel || channel.type !== "discord") return;

    // Use plaintext token if available (in-memory), otherwise decrypt
    let botToken = channel.metadata["botTokenPlain"] as string | undefined;
    if (!botToken) {
      const encrypted = channel.metadata["botToken"] as string | undefined;
      if (encrypted) {
        const { decryptToken } = await import("../crypto.ts");
        botToken = await decryptToken(encrypted);
      }
    }
    const discordChannelId = payload.metadata?.["discordChannelId"] as
      | string
      | undefined;

    if (!botToken || !discordChannelId) {
      logger.error(
        "responder",
        "Discord reply missing botToken or discordChannelId",
        {
          userId,
          channelId: payload.channelId,
        },
      );
      return;
    }

    await sendDiscordReply(botToken, discordChannelId, payload.content);
  } catch (err) {
    logger.error("responder", "Failed to send Discord reply", {
      userId,
      channelId: payload.channelId,
      error: String(err),
    });
  }
}

async function sendEmailReplyAsync(
  userId: string,
  payload: ReplyPayload,
): Promise<void> {
  try {
    const session = await getSessionByUserId(userId);
    if (!session) return;

    const channel = session.channels.find((ch) => ch.id === payload.channelId);
    if (!channel || channel.type !== "email") return;

    const fromAddress = channel.metadata["fromAddress"] as string | undefined;
    const toAddress = payload.metadata?.["senderAddress"] as
      | string
      | undefined;
    const originalSubject = payload.metadata?.["subject"] as
      | string
      | undefined;

    if (!fromAddress || !toAddress) {
      logger.error(
        "responder",
        "Email reply missing fromAddress or toAddress",
        {
          userId,
          channelId: payload.channelId,
        },
      );
      return;
    }

    const subject = originalSubject
      ? `Re: ${originalSubject.replace(/^Re:\s*/i, "")}`
      : "Re: (no subject)";

    // Build threading headers from the original message metadata
    const originalMessageId = payload.metadata?.["emailMessageId"] as
      | string
      | undefined;
    const originalReferences = payload.metadata?.["references"] as
      | string
      | undefined;

    const threadingHeaders = originalMessageId
      ? {
        inReplyTo: originalMessageId,
        // Append original Message-ID to existing References chain
        references: originalReferences
          ? `${originalReferences} ${originalMessageId}`
          : originalMessageId,
      }
      : undefined;

    await sendEmailReply(
      fromAddress,
      toAddress,
      subject,
      payload.content,
      threadingHeaders,
    );
  } catch (err) {
    logger.error("responder", "Failed to send email reply", {
      userId,
      channelId: payload.channelId,
      error: String(err),
    });
  }
}
