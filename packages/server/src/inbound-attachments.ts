import type { UserSession } from "./auth.ts";
import { decryptToken } from "./crypto.ts";
import { logger } from "./logger.ts";
import type { InboundAttachment, InboundAttachmentRef } from "./store.ts";

export const MAX_INBOUND_ATTACHMENTS = 3;
export const MAX_INBOUND_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const TELEGRAM_FILE_BASE = "https://api.telegram.org/file/bot";
const RESEND_API_BASE = "https://api.resend.com";
const RESEND_CDN_HOST = "inbound-cdn.resend.com";

export interface ResendAttachmentMetadata {
  id: string;
  filename?: string;
  size?: number;
  content_type?: string;
  content_disposition?: string;
  content_id?: string;
  download_url?: string;
  expires_at?: string;
}

export function sanitizeInboundFilename(
  value: string | undefined,
  fallback = "attachment",
): string {
  const leaf = (value || fallback).replace(/\\/g, "/").split("/").pop() ||
    fallback;
  const cleaned = leaf
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 160);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

export function sanitizeMimeType(value: string | undefined): string {
  if (!value) return "application/octet-stream";
  const mime = value.toLowerCase().split(";", 1)[0].trim();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
      mime,
    )
    ? mime
    : "application/octet-stream";
}

export function publicAttachment(
  filename: string,
  mimeType: string | undefined,
  size: number | undefined,
): InboundAttachment {
  const safeMime = sanitizeMimeType(mimeType);
  return {
    id: crypto.randomUUID(),
    filename: sanitizeInboundFilename(filename),
    mimeType: safeMime,
    size: Number.isSafeInteger(size) && (size as number) >= 0
      ? size as number
      : 0,
    kind: safeMime.startsWith("image/") ? "image" : "file",
  };
}

/** Read a provider response with both declared-length and actual-byte caps. */
export async function readBoundedResponse(
  response: Response,
  maxBytes = MAX_INBOUND_ATTACHMENT_BYTES,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`attachment exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("attachment too large");
        throw new Error(`attachment exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function channelToken(
  session: UserSession,
  channelId: string,
): Promise<string> {
  const channel = session.channels.find((candidate) =>
    candidate.id === channelId && candidate.type === "telegram"
  );
  if (!channel) throw new Error("Telegram channel no longer exists");
  const plain = channel.metadata?.["botTokenPlain"] as string | undefined;
  if (plain) return Promise.resolve(plain);
  const encrypted = channel.metadata?.["botToken"] as string | undefined;
  if (!encrypted) throw new Error("Telegram channel credentials unavailable");
  return decryptToken(encrypted);
}

async function downloadTelegram(
  session: UserSession,
  ref: Extract<InboundAttachmentRef, { provider: "telegram" }>,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const token = await channelToken(session, ref.channelId);
  const metadataResponse = await fetchImpl(
    `${TELEGRAM_API_BASE}${token}/getFile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: ref.fileId }),
    },
  );
  const metadata = await metadataResponse.json().catch(() => null) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  } | null;
  if (!metadataResponse.ok || !metadata?.ok || !metadata.result?.file_path) {
    throw new Error(metadata?.description || "Telegram getFile failed");
  }
  if (
    typeof metadata.result.file_size === "number" &&
    metadata.result.file_size > MAX_INBOUND_ATTACHMENT_BYTES
  ) {
    throw new Error("Telegram attachment exceeds size limit");
  }
  const filePath = metadata.result.file_path;
  if (
    !/^[A-Za-z0-9_./-]+$/.test(filePath) ||
    filePath.split("/").some((part) => part === "..")
  ) {
    throw new Error("Telegram returned an invalid file path");
  }
  const response = await fetchImpl(
    `${TELEGRAM_FILE_BASE}${token}/${filePath}`,
  );
  if (!response.ok) {
    throw new Error(`Telegram download failed (${response.status})`);
  }
  return readBoundedResponse(response);
}

function validateResendDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.hostname !== RESEND_CDN_HOST ||
    url.username ||
    url.password
  ) {
    throw new Error("Resend returned an invalid attachment URL");
  }
  return url;
}

async function getResendAttachmentMetadata(
  emailId: string,
  attachmentId: string,
  fetchImpl: typeof fetch,
): Promise<ResendAttachmentMetadata> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("Resend credentials unavailable");
  const response = await fetchImpl(
    `${RESEND_API_BASE}/emails/receiving/${
      encodeURIComponent(emailId)
    }/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { "Authorization": `Bearer ${apiKey}` } },
  );
  if (!response.ok) {
    throw new Error(`Resend attachment lookup failed (${response.status})`);
  }
  return await response.json() as ResendAttachmentMetadata;
}

async function downloadResend(
  ref: Extract<InboundAttachmentRef, { provider: "resend" }>,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const metadata = await getResendAttachmentMetadata(
    ref.emailId,
    ref.providerAttachmentId,
    fetchImpl,
  );
  if (
    typeof metadata.size === "number" &&
    metadata.size > MAX_INBOUND_ATTACHMENT_BYTES
  ) {
    throw new Error("Email attachment exceeds size limit");
  }
  if (!metadata.download_url) {
    throw new Error("Resend attachment has no download URL");
  }
  if (metadata.expires_at && Date.parse(metadata.expires_at) <= Date.now()) {
    throw new Error("Resend attachment URL has expired");
  }
  const response = await fetchImpl(
    validateResendDownloadUrl(metadata.download_url),
  );
  if (!response.ok) {
    throw new Error(`Resend attachment download failed (${response.status})`);
  }
  return readBoundedResponse(response);
}

export async function downloadInboundAttachment(
  session: UserSession,
  ref: InboundAttachmentRef,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const bytes = ref.provider === "telegram"
    ? await downloadTelegram(session, ref, fetchImpl)
    : await downloadResend(ref, fetchImpl);
  if (ref.attachment.size && bytes.byteLength !== ref.attachment.size) {
    logger.warn(
      "attachments",
      "Inbound attachment size differed from webhook metadata",
      {
        attachmentId: ref.attachment.id,
        expected: ref.attachment.size,
        actual: bytes.byteLength,
      },
    );
  }
  const filename = sanitizeInboundFilename(ref.attachment.filename);
  const headerFilename = filename.replace(/[^\x20-\x7e"\\]/g, "_");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": sanitizeMimeType(ref.attachment.mimeType),
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${headerFilename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function buildResendInboundAttachmentRefs(
  items: ResendAttachmentMetadata[],
  emailId: string,
  channelId: string,
): InboundAttachmentRef[] {
  const refs: InboundAttachmentRef[] = [];
  for (const item of items) {
    if (
      refs.length >= MAX_INBOUND_ATTACHMENTS ||
      !item.id ||
      (typeof item.size === "number" &&
        item.size > MAX_INBOUND_ATTACHMENT_BYTES)
    ) continue;
    refs.push({
      provider: "resend",
      channelId,
      emailId,
      providerAttachmentId: item.id,
      attachment: publicAttachment(
        item.filename || `email-attachment-${refs.length + 1}`,
        item.content_type,
        item.size,
      ),
    });
  }
  return refs;
}

export async function listResendAttachments(
  emailId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendAttachmentMetadata[]> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return [];
  try {
    const response = await fetchImpl(
      `${RESEND_API_BASE}/emails/receiving/${
        encodeURIComponent(emailId)
      }/attachments`,
      { headers: { "Authorization": `Bearer ${apiKey}` } },
    );
    if (!response.ok) {
      logger.warn("email", "Failed to list inbound email attachments", {
        emailId,
        status: response.status,
      });
      return [];
    }
    const result = await response.json() as {
      data?: ResendAttachmentMetadata[];
    };
    return Array.isArray(result.data) ? result.data : [];
  } catch {
    logger.warn("email", "Error listing inbound email attachments", {
      emailId,
    });
    return [];
  }
}
