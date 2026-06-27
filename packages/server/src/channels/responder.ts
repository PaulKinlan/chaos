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
    if (!channel || channel.type !== "telegram") {
      logger.error(
        "responder",
        "Telegram reply: channel not found/wrong type",
        {
          userId,
          channelId: payload.channelId,
          found: !!channel,
          type: channel?.type,
        },
      );
      return;
    }

    // Use plaintext token if available (in-memory), otherwise decrypt. The
    // plaintext token is lost on isolate restart, so the decrypt path is the
    // normal case after a redeploy.
    let tokenSource = "plain";
    let botToken = channel.metadata["botTokenPlain"] as string | undefined;
    if (!botToken) {
      const encrypted = channel.metadata["botToken"] as string | undefined;
      if (encrypted) {
        try {
          const { decryptToken } = await import("../crypto.ts");
          botToken = await decryptToken(encrypted);
          tokenSource = "decrypted";
        } catch (err) {
          logger.error("responder", "Telegram reply: botToken decrypt failed", {
            userId,
            channelId: payload.channelId,
            error: String(err),
          });
          return;
        }
      }
    }

    // chatId: prefer what the reply carries, else the recorded inbound target.
    let chatId = payload.metadata?.["chatId"] as string | number | undefined;
    let chatIdSource = "payload";
    if (chatId === undefined) {
      const { getReplyTarget } = await import("../store.ts");
      chatId = await getReplyTarget(payload.channelId);
      chatIdSource = "replyTarget";
    }

    if (!botToken || chatId === undefined) {
      logger.error("responder", "Telegram reply: cannot send", {
        userId,
        channelId: payload.channelId,
        hasBotToken: !!botToken,
        tokenSource: botToken ? tokenSource : "(none)",
        hasChatId: chatId !== undefined,
        triedReplyTarget: chatIdSource === "replyTarget",
      });
      return;
    }

    logger.info("responder", "Sending Telegram reply", {
      userId,
      channelId: payload.channelId,
      chatId,
      chatIdSource,
      tokenSource,
      contentLength: payload.content.length,
    });
    await sendTelegramReply(botToken, chatId, payload.content);
    logger.info("responder", "Telegram reply delivered", {
      userId,
      channelId: payload.channelId,
      chatId,
    });
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
    if (!channel || channel.type !== "discord") {
      logger.error("responder", "Discord reply: channel not found/wrong type", {
        userId,
        channelId: payload.channelId,
        found: !!channel,
        type: channel?.type,
      });
      return;
    }

    // Use plaintext token if available (in-memory), otherwise decrypt. The
    // plaintext token is lost on isolate restart, so the decrypt path is the
    // normal case after a redeploy.
    let tokenSource = "plain";
    let botToken = channel.metadata["botTokenPlain"] as string | undefined;
    if (!botToken) {
      const encrypted = channel.metadata["botToken"] as string | undefined;
      if (encrypted) {
        try {
          const { decryptToken } = await import("../crypto.ts");
          botToken = await decryptToken(encrypted);
          tokenSource = "decrypted";
        } catch (err) {
          logger.error("responder", "Discord reply: botToken decrypt failed", {
            userId,
            channelId: payload.channelId,
            error: String(err),
          });
          return;
        }
      }
    }

    // discordChannelId: prefer the reply payload, else the recorded inbound
    // target (the agent never sees it).
    let discordChannelId = payload.metadata?.["discordChannelId"] as
      | string
      | undefined;
    let idSource = "payload";
    if (!discordChannelId) {
      const { getReplyTarget } = await import("../store.ts");
      discordChannelId = await getReplyTarget(payload.channelId);
      idSource = "replyTarget";
    }

    if (!botToken || !discordChannelId) {
      logger.error("responder", "Discord reply: cannot send", {
        userId,
        channelId: payload.channelId,
        hasBotToken: !!botToken,
        tokenSource: botToken ? tokenSource : "(none)",
        hasDiscordChannelId: !!discordChannelId,
        triedReplyTarget: idSource === "replyTarget",
      });
      return;
    }

    logger.info("responder", "Sending Discord reply", {
      userId,
      channelId: payload.channelId,
      discordChannelId,
      idSource,
      tokenSource,
      contentLength: payload.content.length,
    });
    await sendDiscordReply(botToken, discordChannelId, payload.content);
    logger.info("responder", "Discord reply delivered", {
      userId,
      channelId: payload.channelId,
      discordChannelId,
    });
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

    const fromAddress = (channel.metadata["inboundAddress"] as string) ||
      (channel.metadata["fromAddress"] as string) || undefined;
    // toAddress: prefer the reply payload, else the recorded inbound sender
    // (the agent never sees the sender address).
    let toAddress = payload.metadata?.["senderAddress"] as string | undefined;
    let toSource = "payload";
    if (!toAddress) {
      const { getReplyTarget } = await import("../store.ts");
      toAddress = await getReplyTarget(payload.channelId);
      toSource = "replyTarget";
    }
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
          fromAddress: fromAddress || "(missing)",
          toAddress: toAddress || "(missing)",
          toSource,
          metadataKeys: Object.keys(channel.metadata).join(","),
          payloadMetadataKeys: payload.metadata
            ? Object.keys(payload.metadata).join(",")
            : "(none)",
        },
      );
      return;
    }
    logger.info("responder", "Sending email reply", {
      userId,
      channelId: payload.channelId,
      toAddress,
      toSource,
      fromAddress,
    });

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
    logger.info("responder", "Email reply delivered", {
      userId,
      channelId: payload.channelId,
      toAddress,
    });
  } catch (err) {
    logger.error("responder", "Failed to send email reply", {
      userId,
      channelId: payload.channelId,
      error: String(err),
    });
  }
}
