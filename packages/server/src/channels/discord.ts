// Discord bot channel handler
// Registers Discord bots, handles webhook events, and sends replies

import { addMessage, type StoredMessage } from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { logger } from "../logger.ts";

// ── Discord API types ──

export interface DiscordConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
  avatar?: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  guild_id?: string;
}

interface DiscordGetMeResponse {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

// ── Discord API helpers ──

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function discordApiCall(
  botToken: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const url = `${DISCORD_API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Authorization": `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  return fetch(url, options);
}

// ── Registration ──

export async function registerDiscordBot(
  userId: string,
  botToken: string,
  serverBaseUrl: string,
  channelId: string,
): Promise<{ botUsername: string; webhookSecret: string }> {
  logger.info("discord", "Registering Discord bot", { userId, channelId });

  // 1. Validate the bot token via GET /users/@me
  const getMeResp = await discordApiCall(botToken, "GET", "/users/@me");
  if (!getMeResp.ok) {
    const status = getMeResp.status;
    logger.error("discord", "Discord API unreachable or invalid token", {
      userId,
      channelId,
      status,
    });
    throw new Error(`Discord API error: ${status}`);
  }

  const getMeData: DiscordGetMeResponse = await getMeResp.json();
  if (!getMeData.id || !getMeData.username) {
    logger.error("discord", "Invalid bot token — no user returned", {
      userId,
      channelId,
    });
    throw new Error("Invalid bot token: GET /users/@me returned no user");
  }

  const botUsername = getMeData.username;

  // 2. Generate a webhook secret for verifying incoming events
  const webhookSecret = crypto.randomUUID();

  // Note: Unlike Telegram, Discord doesn't have a simple setWebhook API.
  // The caller is responsible for configuring the Discord bot's interaction
  // endpoint URL or using a gateway relay that forwards events to:
  //   POST {serverBaseUrl}/discord/{channelId}?secret={webhookSecret}

  logger.info("discord", "Discord bot registered", {
    userId,
    channelId,
    botUsername,
    webhookUrl: `${serverBaseUrl}/discord/${channelId}?secret=${webhookSecret}`,
  });

  return { botUsername, webhookSecret };
}

// ── Webhook handler ──

export async function handleDiscordWebhook(
  channelId: string,
  req: Request,
): Promise<Response> {
  logger.info("discord", "Incoming Discord event", { channelId });

  // Look up the channel owner
  const session = await getSessionByChannelId(channelId);
  if (!session) {
    logger.error("discord", "Unknown channel for Discord webhook", {
      channelId,
    });
    return jsonResponse({ error: "Unknown channel" }, 404);
  }

  // Find the channel config
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "discord") {
    logger.error("discord", "Channel is not a Discord type", { channelId });
    return jsonResponse({ error: "Channel is not a Discord channel" }, 400);
  }

  // Verify the webhook secret
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expectedSecret = channel.metadata?.["webhookSecret"] as
    | string
    | undefined;
  if (expectedSecret && secret !== expectedSecret) {
    logger.error("discord", "Invalid Discord webhook secret", { channelId });
    return jsonResponse({ error: "Invalid secret" }, 401);
  }

  // Parse the incoming event
  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    logger.error("discord", "Invalid JSON body in Discord webhook", {
      channelId,
    });
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Handle Discord interaction ping (type 1) — required for interaction endpoints
  if (event.type === 1) {
    return jsonResponse({ type: 1 });
  }

  // Extract message content from various Discord event shapes
  let content = "";
  let from = "unknown";
  let senderId: string | undefined;
  let discordChannelId: string | undefined;
  const metadata: Record<string, unknown> = {
    channelDirection: channel.direction || "bidirectional",
    ...(channel.agentId ? { channelAgentId: channel.agentId } : {}),
  };

  // Standard message event (from gateway relay or webhook forwarding)
  const msg = (event.message || event.d || event) as Record<string, unknown>;
  const author = msg.author as DiscordUser | undefined;

  if (msg.content && typeof msg.content === "string") {
    content = msg.content;
    from = author?.username || "unknown";
    senderId = author?.id;
    discordChannelId = msg.channel_id as string | undefined;
    metadata.discordChannelId = discordChannelId;
    metadata.senderId = senderId;
    metadata.messageId = msg.id;
    metadata.guildId = msg.guild_id;
    if (msg.edited_timestamp) {
      metadata.edited = true;
    }
  }

  if (!content) {
    return jsonResponse({ ok: true });
  }

  // Ignore messages from bots (including our own)
  if (author?.bot) {
    return jsonResponse({ ok: true });
  }

  // ── Pairing code flow ──
  const pairingCode = channel.metadata["pairingCode"] as string | undefined;
  if (pairingCode && content.trim() === pairingCode && senderId !== undefined) {
    const allowlist = channel.metadata["allowedUsers"] as string[] || [];
    if (!allowlist.includes(senderId)) {
      allowlist.push(senderId);
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
    logger.info("discord", "User paired via code", {
      channelId,
      senderId,
      from,
    });

    // Send confirmation
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
    if (botToken && discordChannelId) {
      await sendDiscordReply(
        botToken,
        discordChannelId,
        "Paired successfully! You're now authorized to use this bot.",
      ).catch(() => {});
    }
    return jsonResponse({ ok: true });
  }

  // ── Allowlist check ──
  const allowlist = channel.metadata["allowedUsers"] as string[] | undefined;
  if (allowlist && allowlist.length > 0 && senderId !== undefined) {
    if (!allowlist.includes(senderId)) {
      logger.warn("discord", "Sender not in allowlist", {
        channelId,
        senderId,
        from,
      });
      if (discordChannelId) {
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
          await sendDiscordReply(
            botToken,
            discordChannelId,
            "You are not authorized to use this bot. Ask the owner for a pairing code.",
          ).catch(() => {});
        }
      }
      return jsonResponse({ ok: true });
    }
  }

  // Store as a ChannelMessage
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: "discord",
    channelId,
    from,
    content,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await addMessage(session.userId, message);

  logger.info("discord", "Discord message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from,
  });

  return jsonResponse({ ok: true, messageId: message.id });
}

// ── Send reply ──

export async function sendDiscordReply(
  botToken: string,
  discordChannelId: string,
  text: string,
): Promise<void> {
  const resp = await discordApiCall(
    botToken,
    "POST",
    `/channels/${discordChannelId}/messages`,
    { content: text },
  );

  if (!resp.ok) {
    const body = await resp.text();
    logger.error("discord", "Discord sendMessage failed", {
      discordChannelId,
      status: resp.status,
      body,
    });
    throw new Error(`Discord sendMessage failed: ${resp.status} ${body}`);
  }
  logger.info("discord", "Discord reply sent", { discordChannelId });
}

// ── Utility ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
