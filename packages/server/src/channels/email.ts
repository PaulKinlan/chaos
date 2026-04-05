// Email channel handler
// Single inbound webhook routes by "to" address. Sender allowlist filtering.
// Uses Resend for sending verification emails and replies.

import { addMessage, type StoredMessage } from "../store.ts";
import { getSessionByChannelId } from "../auth.ts";
import { getKv, isKvAvailable } from "../kv.ts";
import { logger } from "../logger.ts";

// ── Resend inbound webhook types ──

interface ResendEmailHeader {
  name: string;
  value: string;
}

interface ResendInboundEmail {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: ResendEmailHeader[];
}

interface ResendWebhookPayload {
  type: string;
  data: ResendInboundEmail & { id?: string };
}

interface ResendFetchedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: ResendEmailHeader[];
}

// ── Address generation ──

function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function generateSuffix(): string {
  // 10 alphanumeric chars — low collision risk
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

/**
 * Generate a unique inbound address and check KV for collisions.
 */
async function generateUniqueAddress(
  name: string,
  domain: string,
): Promise<string> {
  const sanitized = sanitizeChannelName(name);
  if (!sanitized) {
    throw new Error(
      "Invalid channel name — must contain at least one alphanumeric character",
    );
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = generateSuffix();
    const address = `${sanitized}-${suffix}@${domain}`;

    // Check KV for collision
    if (isKvAvailable() && getKv()) {
      const existing = await getKv()!.get(["email_addresses", address]);
      if (existing.value) continue; // Collision, try again
    }

    return address;
  }

  throw new Error("Failed to generate unique email address after 5 attempts");
}

/**
 * Store the inbound address → channelId mapping in KV for webhook routing.
 */
async function storeAddressMapping(
  address: string,
  channelId: string,
): Promise<void> {
  if (isKvAvailable() && getKv()) {
    await getKv()!.set(["email_addresses", address], channelId);
    logger.info("email", "Address mapping stored", { address, channelId });
  }
}

/**
 * Look up a channelId by inbound address.
 */
export async function lookupChannelByAddress(
  address: string,
): Promise<string | null> {
  if (!isKvAvailable() || !getKv()) return null;
  const result = await getKv()!.get<string>(["email_addresses", address]);
  return result.value;
}

// ── Registration ──

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

  const inboundAddress = await generateUniqueAddress(channelName, domain);
  const verificationToken = crypto.randomUUID();

  // Store the address → channelId mapping in KV
  await storeAddressMapping(inboundAddress, channelId);

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

  logger.info("email", "Email channel verified", { channelId, userEmail });

  return htmlResponse(
    `<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div style="text-align:center;">
        <h1 style="color:#22c55e;">Email verified!</h1>
        <p>Your email address has been verified. You can now send emails to your CHAOS agent.</p>
        <p>You can close this tab.</p>
      </div>
    </body></html>`,
    200,
  );
}

// ── Single inbound webhook — routes by "to" address ──

export async function handleEmailInbound(
  req: Request,
): Promise<Response> {
  logger.info("email", "Incoming email inbound webhook");

  let rawPayload: unknown;
  try {
    rawPayload = await req.json();
  } catch {
    logger.error("email", "Invalid JSON body in email inbound webhook");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Resend sends { type, data: { id, from, to, ... } } for email.received events.
  // Also support the flat format for backwards compatibility.
  let inbound: ResendInboundEmail;
  let resendEmailId: string | undefined;

  const payload = rawPayload as Record<string, unknown>;
  if (
    payload.type && payload.data &&
    typeof payload.data === "object"
  ) {
    const webhookPayload = rawPayload as ResendWebhookPayload;
    inbound = webhookPayload.data;
    resendEmailId = webhookPayload.data.id;
  } else {
    inbound = rawPayload as ResendInboundEmail;
  }

  // If text and html are both empty but we have an email ID, fetch full content from Resend API
  if (!inbound.text && !inbound.html && resendEmailId) {
    logger.info("email", "Body empty in webhook, fetching from Resend API", {
      emailId: resendEmailId,
    });
    const fetched = await fetchEmailFromResend(resendEmailId);
    if (fetched) {
      inbound.text = fetched.text;
      inbound.html = fetched.html;
      if (
        fetched.headers && (!inbound.headers || inbound.headers.length === 0)
      ) {
        inbound.headers = fetched.headers;
      }
    }
  }

  // Extract the "to" address(es)
  const toAddresses = Array.isArray(inbound.to) ? inbound.to : [inbound.to];
  logger.info("email", "Email received", {
    from: inbound.from,
    to: toAddresses,
    subject: inbound.subject,
  });

  // Try each "to" address to find a matching channel
  let channelId: string | null = null;
  let matchedAddress: string | null = null;

  for (const addr of toAddresses) {
    const normalized = extractEmail(addr).toLowerCase();
    channelId = await lookupChannelByAddress(normalized);
    if (channelId) {
      matchedAddress = normalized;
      break;
    }
  }

  if (!channelId || !matchedAddress) {
    logger.warn("email", "No channel found for inbound address", {
      to: toAddresses,
    });
    return jsonResponse({ ok: true }); // Acknowledge but don't process
  }

  // Look up the channel
  const session = await getSessionByChannelId(channelId);
  if (!session) {
    logger.error("email", "Channel owner session not found", { channelId });
    return jsonResponse({ ok: true });
  }

  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== "email") {
    return jsonResponse({ ok: true });
  }

  // Reject unverified channels
  if (!channel.metadata["verified"]) {
    logger.warn("email", "Rejecting email for unverified channel", {
      channelId,
    });
    return jsonResponse({ ok: true });
  }

  // Sender allowlist check
  const senderAddress = inbound.from || "unknown";
  const senderEmail = extractEmail(senderAddress).toLowerCase();
  const allowlist = channel.metadata["allowedSenders"] as string[] | undefined;

  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some((a) => a.toLowerCase() === senderEmail);
    if (!allowed) {
      logger.warn("email", "Sender not in allowlist", {
        channelId,
        sender: senderAddress,
        senderEmail,
        allowedCount: allowlist.length,
      });
      return jsonResponse({ ok: true }); // Silently drop
    }
  }

  // Extract content
  const subject = inbound.subject || "(no subject)";
  const content = inbound.text || stripHtml(inbound.html || "");

  if (!content) {
    return jsonResponse({ ok: true });
  }

  // Extract email threading headers
  const emailMessageId = getHeader(inbound.headers, "Message-ID") ||
    getHeader(inbound.headers, "Message-Id") || "";
  const inReplyTo = getHeader(inbound.headers, "In-Reply-To") || "";
  const references = getHeader(inbound.headers, "References") || "";

  // threadId: use In-Reply-To to tie to existing thread, otherwise start new thread with Message-ID
  const threadId = inReplyTo || emailMessageId;
  const isReply = !!inReplyTo;

  const metadata: Record<string, unknown> = {
    channelDirection: channel.direction || "bidirectional",
    channelName: channel.name,
    senderAddress: senderEmail,
    subject,
    toAddress: matchedAddress,
    // Threading metadata
    threadId,
    isReply,
    emailMessageId,
    inReplyTo,
    references,
  };

  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: "email",
    channelId,
    from: senderEmail,
    content: `Subject: ${subject}\n\n${content}`,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await addMessage(session.userId, message);

  logger.info("email", "Email message stored", {
    channelId,
    messageId: message.id,
    userId: session.userId,
    from: senderEmail,
    subject,
    threadId,
    isReply,
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
      subject: "Verify your CHAOS email channel",
      text:
        `Click the link below to verify your email address for CHAOS.\n\nYour inbound address: ${inboundAddress}\n\n${verifyUrl}\n\nAfter verification, emails you send to ${inboundAddress} will be processed by your CHAOS agent.\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Click the link below to verify your email address for CHAOS.</p>
        <p>Your inbound address: <strong>${inboundAddress}</strong></p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#238636;color:white;text-decoration:none;border-radius:6px;">Verify Email</a></p>
        <p>After verification, emails you send to <strong>${inboundAddress}</strong> will be processed by your CHAOS agent.</p>
        <p style="color:#888;">If you did not request this, you can ignore this email.</p>`,
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
  threadingHeaders?: {
    inReplyTo?: string;
    references?: string;
  },
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  // Build custom headers for email threading
  const customHeaders: Record<string, string> = {};
  if (threadingHeaders?.inReplyTo) {
    customHeaders["In-Reply-To"] = threadingHeaders.inReplyTo;
  }
  if (threadingHeaders?.references) {
    customHeaders["References"] = threadingHeaders.references;
  }

  const body: Record<string, unknown> = {
    from: fromAddress,
    to: toAddress,
    subject,
    text: content,
  };

  if (Object.keys(customHeaders).length > 0) {
    body.headers = customHeaders;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text();
    logger.error("email", "Resend send failed", {
      fromAddress,
      toAddress,
      status: resp.status,
      body: respBody,
    });
    throw new Error(`Resend send failed: ${resp.status} ${respBody}`);
  }

  logger.info("email", "Email reply sent", { fromAddress, toAddress, subject });
}

// ── Resend API helpers ──

/**
 * Fetch full email content from Resend API by email ID.
 */
async function fetchEmailFromResend(
  emailId: string,
): Promise<ResendFetchedEmail | null> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    logger.warn("email", "Cannot fetch email: RESEND_API_KEY not set");
    return null;
  }

  try {
    const resp = await fetch(`https://api.resend.com/emails/${emailId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.error("email", "Failed to fetch email from Resend", {
        emailId,
        status: resp.status,
        body,
      });
      return null;
    }

    return await resp.json() as ResendFetchedEmail;
  } catch (err) {
    logger.error("email", "Error fetching email from Resend", {
      emailId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Extract a header value from the headers array by name (case-insensitive).
 */
function getHeader(
  headers: ResendEmailHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const header = headers.find((h) => h.name.toLowerCase() === lower);
  return header?.value;
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
  return match ? match[1].toLowerCase() : address.trim().toLowerCase();
}

/** Strip HTML tags for plain-text fallback */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}
