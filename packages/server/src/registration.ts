// Per-type channel registration, shared by the signed endpoints
// (/channels/*/register) and the app-session admin UI (/app/api/channels POST),
// so both paths create channels identically. The platform-specific setup
// (Telegram/Discord webhooks, email allocation) lives in ./channels/*; this
// module wraps each with token encryption, config building, and addChannel.

import { addChannel } from "./auth.ts";
import { registerTelegramBot } from "./channels/telegram.ts";
import { registerDiscordBot } from "./channels/discord.ts";
import { registerEmailChannel } from "./channels/email.ts";
import { encryptToken } from "./crypto.ts";
import { logger } from "./logger.ts";
import type { ChannelConfig } from "@chaos/shared";

export interface RegisterResult {
  channel: ChannelConfig;
  // Type-specific extras for the caller (never the raw secret).
  botUsername?: string;
  pairingCode?: string;
  inboundAddress?: string;
  webhookUrl?: string;
}

export async function registerTelegramForUser(
  userId: string,
  botToken: string,
  baseUrl: string,
  agentId = "",
): Promise<RegisterResult> {
  const channelId = crypto.randomUUID();
  const { botUsername, webhookSecret } = await registerTelegramBot(
    userId,
    botToken,
    baseUrl,
    channelId,
  );
  const pairingCode = crypto.randomUUID().slice(0, 8).toUpperCase();
  const channel: ChannelConfig = {
    id: channelId,
    type: "telegram",
    direction: "bidirectional",
    agentId,
    enabled: true,
    metadata: {
      botToken: await encryptToken(botToken), // encrypted at rest
      botTokenPlain: botToken, // in-memory only, not persisted
      botUsername,
      webhookSecret,
      pairingCode,
    },
  };
  await addChannel(userId, channel);
  logger.info("registration", "Telegram channel registered", {
    userId,
    channelId,
    botUsername,
  });
  return { channel, botUsername, pairingCode };
}

export async function registerDiscordForUser(
  userId: string,
  botToken: string,
  baseUrl: string,
  agentId = "",
): Promise<RegisterResult> {
  const channelId = crypto.randomUUID();
  const { botUsername, webhookSecret } = await registerDiscordBot(
    userId,
    botToken,
    baseUrl,
    channelId,
  );
  const pairingCode = crypto.randomUUID().slice(0, 8).toUpperCase();
  const channel: ChannelConfig = {
    id: channelId,
    type: "discord",
    direction: "bidirectional",
    agentId,
    enabled: true,
    metadata: {
      botToken: await encryptToken(botToken),
      botTokenPlain: botToken,
      botUsername,
      webhookSecret,
      pairingCode,
    },
  };
  await addChannel(userId, channel);
  logger.info("registration", "Discord channel registered", {
    userId,
    channelId,
    botUsername,
  });
  return { channel, botUsername, pairingCode };
}

export async function registerEmailForUser(
  userId: string,
  userEmail: string,
  channelName: string,
  baseUrl: string,
  agentId = "",
): Promise<RegisterResult> {
  const domain = Deno.env.get("CHAOS_EMAIL_DOMAIN");
  if (!domain) {
    throw new Error("Email not configured (set CHAOS_EMAIL_DOMAIN)");
  }
  const slug = channelName.trim() ||
    userEmail.split("@")[0].replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "").toLowerCase() ||
    "agent";
  const channelId = crypto.randomUUID();
  const { inboundAddress, verificationToken } = await registerEmailChannel(
    userId,
    userEmail,
    slug,
    domain,
    baseUrl,
    channelId,
  );
  const channel: ChannelConfig = {
    id: channelId,
    type: "email",
    direction: "bidirectional",
    agentId,
    enabled: true,
    metadata: {
      userEmail,
      inboundAddress,
      verificationToken,
      verified: false,
      allowedSenders: [],
    },
  };
  await addChannel(userId, channel);
  logger.info("registration", "Email channel registered (pending verify)", {
    userId,
    channelId,
    inboundAddress,
  });
  return { channel, inboundAddress };
}

export async function registerWebhookForUser(
  userId: string,
  baseUrl: string,
  opts: { name?: string; agentId?: string; direction?: string } = {},
): Promise<RegisterResult> {
  const channelId = crypto.randomUUID();
  const webhookSecret = crypto.randomUUID();
  const channel: ChannelConfig = {
    id: channelId,
    type: "webhook",
    direction: (opts.direction || "inbound") as ChannelConfig["direction"],
    agentId: opts.agentId || "",
    enabled: true,
    ...(opts.name ? { name: opts.name } : {}),
    metadata: { webhookSecret },
  };
  await addChannel(userId, channel);
  const webhookUrl = `${baseUrl}/webhook/${channelId}?token=${webhookSecret}`;
  logger.info("registration", "Webhook channel registered", {
    userId,
    channelId,
  });
  return { channel, webhookUrl };
}
