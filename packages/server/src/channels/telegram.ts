// Telegram bot channel handler
// Registers Telegram bots, handles webhooks, and sends replies

import {
  addInboundAttachmentRef,
  addMessage,
  type InboundAttachmentRef,
  type StoredMessage,
} from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { logger } from "../logger.ts";
import { decodeAttachment, type ReplyAttachment } from "./responder.ts";
import {
  MAX_INBOUND_ATTACHMENT_BYTES,
  MAX_INBOUND_ATTACHMENTS,
  publicAttachment,
} from "../inbound-attachments.ts";

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

interface TelegramFileMedia {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramFileMedia[];
  document?: TelegramFileMedia;
  video?: TelegramFileMedia;
  audio?: TelegramFileMedia;
  voice?: TelegramFileMedia;
  animation?: TelegramFileMedia;
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

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "audio/mpeg") return ".mp3";
  return "";
}

/** Convert Telegram media into public descriptors plus private provider refs. */
export function extractTelegramInboundAttachments(
  message: TelegramMessage,
  channelId: string,
): InboundAttachmentRef[] {
  const media: Array<
    { value: TelegramFileMedia; fallback: string; mime: string }
  > = [];
  if (message.photo?.length) {
    const score = (item: TelegramFileMedia) =>
      item.file_size || (item.width || 0) * (item.height || 0);
    const largest = [...message.photo].sort((a, b) => score(b) - score(a))[0];
    if (largest) {
      media.push({
        value: largest,
        fallback: `photo-${message.message_id}.jpg`,
        mime: "image/jpeg",
      });
    }
  }
  const named = [
    [
      message.document,
      `document-${message.message_id}`,
      "application/octet-stream",
    ],
    [message.video, `video-${message.message_id}.mp4`, "video/mp4"],
    [message.audio, `audio-${message.message_id}.mp3`, "audio/mpeg"],
    [message.voice, `voice-${message.message_id}.ogg`, "audio/ogg"],
    [message.animation, `animation-${message.message_id}.mp4`, "video/mp4"],
  ] as const;
  for (const [value, fallback, mime] of named) {
    if (value) media.push({ value, fallback, mime });
  }

  return media
    .filter(({ value }) =>
      !value.file_size || value.file_size <= MAX_INBOUND_ATTACHMENT_BYTES
    )
    .slice(0, MAX_INBOUND_ATTACHMENTS)
    .map(({ value, fallback, mime }) => {
      const actualMime = value.mime_type || mime;
      const filename = value.file_name ||
        (fallback.includes(".")
          ? fallback
          : fallback + extensionForMime(actualMime));
      return {
        provider: "telegram" as const,
        channelId,
        fileId: value.file_id,
        attachment: publicAttachment(filename, actualMime, value.file_size),
      };
    });
}

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
  let inboundAttachmentRefs: InboundAttachmentRef[] = [];
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
    inboundAttachmentRefs = extractTelegramInboundAttachments(
      telegramMsg,
      channelId,
    );
    content = telegramMsg.text || telegramMsg.caption ||
      (inboundAttachmentRefs.length
        ? `[Received ${inboundAttachmentRefs.length} attachment${
          inboundAttachmentRefs.length === 1 ? "" : "s"
        }.]`
        : "");
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
    ...(inboundAttachmentRefs.length
      ? { attachments: inboundAttachmentRefs.map((ref) => ref.attachment) }
      : {}),
    metadata,
  };

  for (const ref of inboundAttachmentRefs) {
    await addInboundAttachmentRef(session.userId, message.id, ref);
  }
  await addMessage(session.userId, message);

  // Record where to send replies. The agent never sees chatId, so the reply
  // path falls back to this when the reply payload doesn't carry one.
  if (chatId !== undefined) {
    const { setReplyTarget } = await import("../store.ts");
    await setReplyTarget(channelId, String(chatId));
  }

  logger.info("telegram", "Telegram message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from,
    chatId,
  });

  return jsonResponse({ ok: true, messageId: message.id });
}

// ── Send reply ──

export async function sendTelegramReply(
  botToken: string,
  chatId: string | number,
  text: string,
  attachments?: ReplyAttachment[],
): Promise<void> {
  // Telegram captions cap at 1024 chars, so when the text is long (or there is
  // more than one attachment) send the text as its own message first and the
  // media without captions; a short text + single attachment rides as caption.
  const single = attachments?.length === 1;
  const asCaption = single && text.length > 0 && text.length <= 1024;

  if (text.length > 0 && !asCaption) {
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
  }

  for (const a of attachments ?? []) {
    // Images go as photos (inline preview); everything else as a document.
    const isImage = a.mimeType.startsWith("image/") &&
      a.mimeType !== "image/svg+xml"; // Telegram rejects SVG as photo
    const method = isImage ? "sendPhoto" : "sendDocument";
    const field = isImage ? "photo" : "document";
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(
      field,
      new Blob([decodeAttachment(a) as BlobPart], { type: a.mimeType }),
      a.filename,
    );
    if (asCaption) form.append("caption", text);
    const resp = await fetch(
      `${TELEGRAM_API_BASE}${botToken}/${method}`,
      { method: "POST", body: form },
    );
    if (!resp.ok) {
      const body = await resp.text();
      logger.error("telegram", `Telegram ${method} failed`, {
        chatId,
        filename: a.filename,
        status: resp.status,
        body,
      });
      throw new Error(`Telegram ${method} failed: ${resp.status} ${body}`);
    }
    logger.info("telegram", `Telegram attachment sent (${method})`, {
      chatId,
      filename: a.filename,
      mimeType: a.mimeType,
    });
  }
  logger.info("telegram", "Telegram reply sent", {
    chatId,
    attachments: attachments?.length ?? 0,
  });
}

/**
 * Send a chat action (e.g. "typing") so the user sees an activity indicator.
 * Telegram clears it after ~5s or when the next message is sent, so callers
 * repeat it while the agent is working. Best-effort: never throws.
 */
export async function sendTelegramChatAction(
  botToken: string,
  chatId: string | number,
  action = "typing",
): Promise<void> {
  try {
    const resp = await telegramApiCall(botToken, "sendChatAction", {
      chat_id: chatId,
      action,
    });
    if (!resp.ok) {
      logger.warn("telegram", "Telegram sendChatAction failed", {
        chatId,
        status: resp.status,
      });
    }
  } catch (err) {
    logger.warn("telegram", "Telegram sendChatAction error", {
      chatId,
      error: String(err),
    });
  }
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
