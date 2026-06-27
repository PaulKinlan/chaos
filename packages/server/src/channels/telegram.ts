// Telegram bot channel handler
// Registers Telegram bots, handles webhooks, and sends replies

import { addMessage, type StoredMessage } from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { logger } from "../logger.ts";

// ── Telegram API types ──

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  edit_date?: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramGetMeResponse {
  ok: boolean;
  result?: TelegramUser;
  description?: string;
}

interface TelegramSetWebhookResponse {
  ok: boolean;
  result?: boolean;
  description?: string;
}

// ── Telegram API helpers ──

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

async function telegramApiCall(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const url = `${TELEGRAM_API_BASE}${botToken}/${method}`;
  const options: RequestInit = body
    ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
    : { method: "GET" };
  return fetch(url, options);
}

// ── Registration ──

export async function registerTelegramBot(
  userId: string,
  botToken: string,
  serverBaseUrl: string,
  channelId: string,
): Promise<{ botUsername: string; webhookSecret: string }> {
  logger.info("telegram", "Registering Telegram bot", { userId, channelId });

  // 1. Validate the bot token via getMe
  const getMeResp = await telegramApiCall(botToken, "getMe");
  if (!getMeResp.ok) {
    logger.error("telegram", "Telegram API unreachable", {
      userId,
      channelId,
      status: getMeResp.status,
    });
    throw new Error(`Telegram API unreachable: ${getMeResp.status}`);
  }

  const getMeData: TelegramGetMeResponse = await getMeResp.json();
  if (!getMeData.ok || !getMeData.result) {
    logger.error("telegram", "Invalid bot token", {
      userId,
      channelId,
      description: getMeData.description,
    });
    throw new Error(
      `Invalid bot token: ${getMeData.description || "getMe failed"}`,
    );
  }

  const botUsername = getMeData.result.username || getMeData.result.first_name;

  // 2. Generate a webhook secret
  const webhookSecret = crypto.randomUUID();

  // 3. Set the webhook URL
  const webhookUrl =
    `${serverBaseUrl}/telegram/${channelId}?secret=${webhookSecret}`;
  const setWebhookResp = await telegramApiCall(botToken, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "edited_message", "callback_query"],
  });

  if (!setWebhookResp.ok) {
    logger.error("telegram", "Failed to set Telegram webhook", {
      userId,
      channelId,
      status: setWebhookResp.status,
    });
    throw new Error(`Failed to set webhook: ${setWebhookResp.status}`);
  }

  const setWebhookData: TelegramSetWebhookResponse = await setWebhookResp
    .json();
  if (!setWebhookData.ok) {
    logger.error("telegram", "Telegram webhook setup failed", {
      userId,
      channelId,
      description: setWebhookData.description,
    });
    throw new Error(
      `Webhook setup failed: ${
        setWebhookData.description || "setWebhook failed"
      }`,
    );
  }

  logger.info("telegram", "Telegram bot registered", {
    userId,
    channelId,
    botUsername,
  });
  return { botUsername, webhookSecret };
}

// ── Webhook handler ──

export async function handleTelegramWebhook(
  channelId: string,
  req: Request,
): Promise<Response> {
  logger.info("telegram", "Incoming Telegram update", { channelId });

  // Look up the channel owner
  const session = await getSessionByChannelId(channelId);
  if (!session) {
    logger.error("telegram", "Unknown channel for Telegram webhook", {
      channelId,
    });
    return jsonResponse({ error: "Unknown channel" }, 404);
  }

  // Find the channel config
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "telegram") {
    logger.error("telegram", "Channel is not a Telegram type", { channelId });
    return jsonResponse({ error: "Channel is not a Telegram channel" }, 400);
  }

  // Verify the webhook secret
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expectedSecret = channel.metadata?.["webhookSecret"] as
    | string
    | undefined;
  if (expectedSecret && secret !== expectedSecret) {
    logger.error("telegram", "Invalid Telegram webhook secret", { channelId });
    return jsonResponse({ error: "Invalid secret" }, 401);
  }

  // Parse the Telegram update
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    logger.error("telegram", "Invalid JSON body in Telegram webhook", {
      channelId,
    });
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Extract the message content
  const telegramMsg = update.message || update.edited_message;
  let content = "";
  let from = "unknown";
  let senderId: number | undefined;
  let chatId: number | undefined;
  const metadata: Record<string, unknown> = {
    updateId: update.update_id,
    channelDirection: channel.direction || "bidirectional",
    ...(channel.agentId ? { channelAgentId: channel.agentId } : {}),
    ...(channel.runInBackground ? { channelRunInBackground: true } : {}),
    ...(channel.notifyOnComplete !== undefined
      ? { channelNotifyOnComplete: channel.notifyOnComplete }
      : {}),
  };

  if (telegramMsg) {
    content = telegramMsg.text || "";
    from = telegramMsg.from?.username || telegramMsg.from?.first_name ||
      "unknown";
    senderId = telegramMsg.from?.id;
    chatId = telegramMsg.chat.id;
    metadata.chatId = chatId;
    metadata.senderId = senderId;
    metadata.messageId = telegramMsg.message_id;
    metadata.chatType = telegramMsg.chat.type;
    if (telegramMsg.edit_date) {
      metadata.edited = true;
    }
  } else if (update.callback_query) {
    content = update.callback_query.data || "";
    from = update.callback_query.from.username ||
      update.callback_query.from.first_name;
    senderId = update.callback_query.from.id;
    chatId = update.callback_query.message?.chat.id;
    metadata.chatId = chatId;
    metadata.senderId = senderId;
    metadata.callbackQueryId = update.callback_query.id;
  }

  if (!content) {
    return jsonResponse({ ok: true });
  }

  // ── Pairing code flow ──
  // If there's a pairing code and the message matches it, auto-add this user
  const pairingCode = channel.metadata["pairingCode"] as string | undefined;
  if (pairingCode && content.trim() === pairingCode && senderId !== undefined) {
    const allowlist = channel.metadata["allowedUsers"] as string[] || [];
    const senderStr = String(senderId);
    if (!allowlist.includes(senderStr)) {
      allowlist.push(senderStr);
      channel.metadata["allowedUsers"] = allowlist;
    }
    // Clear the pairing code (one-time use)
    delete channel.metadata["pairingCode"];
    // Persist the updated channel
    const { removeChannel: rmCh, addChannel: addCh } = await import(
      "../auth.ts"
    );
    await rmCh(session.userId, channelId);
    await addCh(session.userId, channel);
    logger.info("telegram", "User paired via code", {
      channelId,
      senderId,
      from,
    });

    // Get bot token to send confirmation
    let botToken = channel.metadata["botTokenPlain"] as string | undefined;
    if (!botToken) {
      const encrypted = channel.metadata["botToken"] as string | undefined;
      if (encrypted) {
        try {
          const { decryptToken } = await import("../crypto.ts");
          botToken = await decryptToken(encrypted);
        } catch { /* */ }
      }
    }
    if (botToken && chatId) {
      await sendTelegramReply(
        botToken,
        chatId,
        `Paired successfully! You're now authorized to use this bot.`,
      ).catch(() => {});
    }
    return jsonResponse({ ok: true });
  }

  // ── Allowlist check (fail closed) ──
  // The channel is locked until at least one user has paired. An empty or
  // absent allowlist means nobody is authorized yet, so every message other
  // than the pairing code handled above is rejected. Previously an empty
  // allowlist was treated as "open to everyone", which left the window between
  // registration and the first pairing wide open to anyone who found the bot.
  const allowlist = channel.metadata["allowedUsers"] as string[] | undefined;
  const senderStr = senderId !== undefined ? String(senderId) : undefined;
  const authorized = senderStr !== undefined &&
    Array.isArray(allowlist) && allowlist.includes(senderStr);
  if (!authorized) {
    logger.warn(
      "telegram",
      "Unauthorized sender (channel not paired or sender not allowlisted)",
      {
        channelId,
        senderId,
        from,
      },
    );
    if (chatId) {
      let botToken = channel.metadata["botTokenPlain"] as string | undefined;
      if (!botToken) {
        const encrypted = channel.metadata["botToken"] as string | undefined;
        if (encrypted) {
          try {
            const { decryptToken } = await import("../crypto.ts");
            botToken = await decryptToken(encrypted);
          } catch { /* */ }
        }
      }
      if (botToken) {
        await sendTelegramReply(
          botToken,
          chatId,
          "You are not authorized to use this bot. Send the pairing code to link it, or ask the owner for one.",
        ).catch(() => {});
      }
    }
    return jsonResponse({ ok: true });
  }

  // Store as a ChannelMessage
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: "telegram",
    channelId,
    from,
    content,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await addMessage(session.userId, message);

  logger.info("telegram", "Telegram message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from,
  });

  return jsonResponse({ ok: true, messageId: message.id });
}

// ── Send reply ──

export async function sendTelegramReply(
  botToken: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  const resp = await telegramApiCall(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.error("telegram", "Telegram sendMessage failed", {
      chatId,
      status: resp.status,
      body,
    });
    throw new Error(`Telegram sendMessage failed: ${resp.status} ${body}`);
  }
  logger.info("telegram", "Telegram reply sent", { chatId });
}

// ── Delete webhook (cleanup) ──

export async function deleteTelegramWebhook(botToken: string): Promise<void> {
  await telegramApiCall(botToken, "deleteWebhook");
}

// ── Utility ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
