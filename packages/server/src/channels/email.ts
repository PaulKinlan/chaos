// Email channel handler
// Registers email inbound addresses, handles Resend inbound webhooks, and sends replies

import { addMessage, type StoredMessage } from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { logger } from "../logger.ts";

// ── Resend inbound webhook types ──

interface ResendInboundEmail {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

// ── Registration ──

export function generateInboundAddress(domain: string): string {
  const slug = crypto.randomUUID().slice(0, 12);
  return `${slug}@${domain}`;
}

export async function registerEmailChannel(
  userId: string,
  fromAddress: string,
  domain: string,
): Promise<{ inboundAddress: string }> {
  logger.info("email", "Registering email channel", { userId, fromAddress });

  const inboundAddress = generateInboundAddress(domain);

  logger.info("email", "Email channel registered", {
    userId,
    fromAddress,
    inboundAddress,
  });

  return { inboundAddress };
}

// ── Webhook handler ──

export async function handleEmailWebhook(
  channelId: string,
  req: Request,
): Promise<Response> {
  logger.info("email", "Incoming email webhook", { channelId });

  // Look up the channel owner
  const session = await getSessionByChannelId(channelId);
  if (!session) {
    logger.error("email", "Unknown channel for email webhook", { channelId });
    return jsonResponse({ error: "Unknown channel" }, 404);
  }

  // Find the channel config
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "email") {
    logger.error("email", "Channel is not an email type", { channelId });
    return jsonResponse({ error: "Channel is not an email channel" }, 400);
  }

  // Parse the Resend inbound webhook payload
  let inbound: ResendInboundEmail;
  try {
    inbound = await req.json();
  } catch {
    logger.error("email", "Invalid JSON body in email webhook", { channelId });
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Extract sender, subject, body
  const senderAddress = inbound.from || "unknown";
  const subject = inbound.subject || "(no subject)";
  const bodyText = inbound.text || "";

  if (!bodyText && !inbound.html) {
    return jsonResponse({ ok: true });
  }

  // ── Allowlist check ──
  const allowlist = channel.metadata["allowedSenders"] as string[] | undefined;
  if (allowlist && allowlist.length > 0) {
    // Normalize: extract email from "Name <email>" format
    const senderEmail = extractEmail(senderAddress);
    if (!allowlist.includes(senderEmail)) {
      logger.warn("email", "Sender not in allowlist", {
        channelId,
        sender: senderAddress,
        senderEmail,
      });
      return jsonResponse({ ok: true });
    }
  }

  // Build content from subject + body
  const content = bodyText || stripHtml(inbound.html || "");

  const metadata: Record<string, unknown> = {
    channelDirection: channel.direction || "bidirectional",
    senderAddress,
    subject,
    toAddress: Array.isArray(inbound.to) ? inbound.to[0] : inbound.to,
  };

  // Store as a ChannelMessage
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: "email",
    channelId,
    from: senderAddress,
    content,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await addMessage(session.userId, message);

  logger.info("email", "Email message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from: senderAddress,
    subject,
  });

  return jsonResponse({ ok: true, messageId: message.id });
}

// ── Send reply via Resend API ──

export async function sendEmailReply(
  fromAddress: string,
  toAddress: string,
  subject: string,
  content: string,
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: toAddress,
      subject,
      text: content,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.error("email", "Resend send failed", {
      fromAddress,
      toAddress,
      status: resp.status,
      body,
    });
    throw new Error(`Resend send failed: ${resp.status} ${body}`);
  }

  logger.info("email", "Email reply sent", { fromAddress, toAddress, subject });
}

// ── Utility ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Extract bare email from "Display Name <email@example.com>" format */
function extractEmail(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return match ? match[1] : address.trim();
}

/** Strip HTML tags for plain-text fallback */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}
