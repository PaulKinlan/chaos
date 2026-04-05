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

/**
 * Sanitize a channel name into a valid email local part.
 * Lowercases, strips spaces, removes characters not suitable for email addresses.
 */
function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[-._]+|[-._]+$/g, "");
}

export async function registerEmailChannel(
  userId: string,
  userEmail: string,
  channelName: string,
  domain: string,
  serverBaseUrl: string,
  channelId: string,
): Promise<{
  inboundAddress: string;
  verificationToken: string;
}> {
  logger.info("email", "Registering email channel", {
    userId,
    userEmail,
    channelName,
  });

  const sanitized = sanitizeChannelName(channelName);
  if (!sanitized) {
    throw new Error(
      "Invalid channel name — must contain at least one alphanumeric character",
    );
  }

  const inboundAddress = `${sanitized}@${domain}`;
  const verificationToken = crypto.randomUUID();

  // Send verification email via Resend
  const verifyUrl =
    `${serverBaseUrl}/email/verify?token=${verificationToken}&channelId=${channelId}`;

  await sendVerificationEmail(userEmail, inboundAddress, verifyUrl);

  logger.info("email", "Email channel registered (pending verification)", {
    userId,
    userEmail,
    inboundAddress,
  });

  return { inboundAddress, verificationToken };
}

// ── Verification ──

export async function handleEmailVerification(
  token: string,
  channelId: string,
  getSession: (
    channelId: string,
  ) => Promise<
    | {
      userId: string;
      channels: {
        id: string;
        type: string;
        metadata: Record<string, unknown>;
      }[];
    }
    | null
  >,
  updateMetadata: (
    userId: string,
    channelId: string,
    metadata: Record<string, unknown>,
  ) => Promise<void>,
): Promise<Response> {
  const session = await getSession(channelId);
  if (!session) {
    return htmlResponse("Verification failed: channel not found.", 404);
  }

  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "email") {
    return htmlResponse("Verification failed: not an email channel.", 400);
  }

  const storedToken = channel.metadata["verificationToken"] as
    | string
    | undefined;
  if (!storedToken || storedToken !== token) {
    return htmlResponse("Verification failed: invalid or expired token.", 400);
  }

  // Mark as verified and add user email to allowedSenders
  const userEmail = channel.metadata["userEmail"] as string;
  const existingSenders = (channel.metadata["allowedSenders"] as string[]) ||
    [];
  const allowedSenders = existingSenders.includes(userEmail)
    ? existingSenders
    : [...existingSenders, userEmail];

  await updateMetadata(session.userId, channelId, {
    ...channel.metadata,
    verified: true,
    verificationToken: "", // Clear the token
    allowedSenders,
  });

  logger.info("email", "Email channel verified", {
    channelId,
    userEmail,
  });

  return htmlResponse(
    `<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div style="text-align:center;">
        <h1 style="color:#22c55e;">Email verified!</h1>
        <p>You can close this tab.</p>
      </div>
    </body></html>`,
    200,
  );
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

  // Reject unverified channels
  if (!channel.metadata["verified"]) {
    logger.warn("email", "Rejecting webhook for unverified channel", {
      channelId,
    });
    return jsonResponse({ error: "Channel not verified" }, 403);
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

// ── Send verification email via Resend API ──

async function sendVerificationEmail(
  toAddress: string,
  inboundAddress: string,
  verifyUrl: string,
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const domain = inboundAddress.split("@")[1];
  const fromAddress = `noreply@${domain}`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: toAddress,
      subject: "Verify your email channel",
      text:
        `Click the link below to verify your email address for the inbound address ${inboundAddress}:\n\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
      html:
        `<p>Click the link below to verify your email address for the inbound address <strong>${inboundAddress}</strong>:</p><p><a href="${verifyUrl}">Verify Email</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.error("email", "Resend verification email failed", {
      toAddress,
      status: resp.status,
      body,
    });
    throw new Error(
      `Failed to send verification email: ${resp.status} ${body}`,
    );
  }

  logger.info("email", "Verification email sent", {
    toAddress,
    inboundAddress,
  });
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

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
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
