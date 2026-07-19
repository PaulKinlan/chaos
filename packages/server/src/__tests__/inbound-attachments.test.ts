import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildResendInboundAttachmentRefs,
  downloadInboundAttachment,
  listResendAttachments,
  MAX_INBOUND_ATTACHMENT_BYTES,
  publicAttachment,
  readBoundedResponse,
  sanitizeInboundFilename,
  sanitizeMimeType,
} from "../inbound-attachments.ts";
import { extractTelegramInboundAttachments } from "../channels/telegram.ts";
import type { UserSession } from "../auth.ts";
import { addInboundAttachmentRef, getInboundAttachmentRef } from "../store.ts";

Deno.test("inbound attachment metadata is sanitized and bounded", () => {
  assertEquals(sanitizeInboundFilename("../../etc/passwd"), "passwd");
  assertEquals(sanitizeInboundFilename("..\\evil\u0000.png"), "evil.png");
  assertEquals(sanitizeMimeType("IMAGE/PNG; charset=x"), "image/png");
  assertEquals(sanitizeMimeType("not a mime"), "application/octet-stream");
  const item = publicAttachment("../photo.png", "image/png", 42);
  assertEquals(item.filename, "photo.png");
  assertEquals(item.kind, "image");
  assertEquals(item.size, 42);
});

Deno.test("readBoundedResponse rejects declared and streamed oversize bodies", async () => {
  await assertRejects(
    () =>
      readBoundedResponse(
        new Response("x", {
          headers: {
            "content-length": String(MAX_INBOUND_ATTACHMENT_BYTES + 1),
          },
        }),
      ),
    Error,
    "exceeds",
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  await assertRejects(
    () => readBoundedResponse(new Response(stream), 7),
    Error,
    "exceeds",
  );
  const exact = await readBoundedResponse(
    new Response(new Uint8Array([1, 2, 3])),
    3,
  );
  assertEquals([...exact], [1, 2, 3]);
});

Deno.test("Telegram extraction chooses largest photo and keeps bounded media", () => {
  const refs = extractTelegramInboundAttachments({
    message_id: 9,
    chat: { id: 1, type: "private" },
    date: 1,
    photo: [
      { file_id: "small", file_size: 10, width: 10, height: 10 },
      { file_id: "large", file_size: 20, width: 20, height: 20 },
    ],
    document: {
      file_id: "doc",
      file_name: "../../notes.txt",
      mime_type: "text/plain",
      file_size: 30,
    },
  }, "channel-1");
  assertEquals(refs.length, 2);
  assertEquals(refs[0].provider, "telegram");
  if (refs[0].provider === "telegram") assertEquals(refs[0].fileId, "large");
  assertEquals(refs[1].attachment.filename, "notes.txt");
});

Deno.test("Telegram extraction drops oversize media and caps count at three", () => {
  const refs = extractTelegramInboundAttachments({
    message_id: 10,
    chat: { id: 1, type: "private" },
    date: 1,
    document: {
      file_id: "too-large",
      file_size: MAX_INBOUND_ATTACHMENT_BYTES + 1,
    },
    video: { file_id: "video", file_size: 1 },
    audio: { file_id: "audio", file_size: 1 },
    voice: { file_id: "voice", file_size: 1 },
    animation: { file_id: "animation", file_size: 1 },
  }, "channel-1");
  assertEquals(refs.length, 3);
  assertEquals(
    refs.some((ref) =>
      ref.provider === "telegram" && ref.fileId === "too-large"
    ),
    false,
  );
});

Deno.test("Resend descriptors are sanitized, bounded, and capped", () => {
  const refs = buildResendInboundAttachmentRefs(
    [
      { id: "a", filename: "../../a.png", size: 3, content_type: "image/png" },
      {
        id: "oversize",
        filename: "large.bin",
        size: MAX_INBOUND_ATTACHMENT_BYTES + 1,
      },
      { id: "b", filename: "b.txt", size: 2, content_type: "text/plain" },
      { id: "c", filename: "c.txt", size: 2, content_type: "text/plain" },
      { id: "d", filename: "d.txt", size: 2, content_type: "text/plain" },
    ],
    "email-id",
    "channel-id",
  );
  assertEquals(refs.length, 3);
  assertEquals(refs[0].attachment.filename, "a.png");
  assertEquals(
    refs.some((ref) =>
      ref.provider === "resend" && ref.providerAttachmentId === "oversize"
    ),
    false,
  );
  assertEquals(
    refs.every((ref) =>
      ref.provider === "resend" && ref.emailId === "email-id"
    ),
    true,
  );
});

Deno.test("Telegram attachment retrieval performs getFile then a bounded download", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/getFile")) {
      return Response.json({
        ok: true,
        result: { file_path: "photos/x.jpg", file_size: 3 },
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-length": "3", "content-type": "image/jpeg" },
    });
  }) as typeof fetch;
  const session: UserSession = {
    userId: "user",
    apiKey: "key",
    createdAt: new Date().toISOString(),
    channels: [{
      id: "channel",
      type: "telegram",
      direction: "bidirectional",
      agentId: "agent",
      enabled: true,
      metadata: { botTokenPlain: "test-token" },
    }],
  };
  const attachment = publicAttachment("photo.jpg", "image/jpeg", 3);
  const response = await downloadInboundAttachment(session, {
    provider: "telegram",
    channelId: "channel",
    fileId: "provider-id",
    attachment,
  }, fetchImpl);
  assertEquals([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].endsWith("/bottest-token/getFile"), true);
  assertEquals(calls[1].endsWith("/bottest-token/photos/x.jpg"), true);
});

Deno.test("Resend attachment list and retrieval do not expose or persist signed URLs", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/attachments")) {
      return Response.json({
        data: [{
          id: "att-provider",
          filename: "mail.png",
          size: 3,
          content_type: "image/png",
        }],
      });
    }
    if (url.startsWith("https://inbound-cdn.resend.com/")) {
      return new Response(new Uint8Array([9, 8, 7]), {
        headers: { "content-length": "3" },
      });
    }
    if (url.includes("/attachments/att-provider")) {
      return Response.json({
        id: "att-provider",
        filename: "mail.png",
        size: 3,
        content_type: "image/png",
        download_url:
          "https://inbound-cdn.resend.com/email/attachments/att-provider?signature=secret",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  Deno.env.set("RESEND_API_KEY", "test-only");
  try {
    const listed = await listResendAttachments("email-id", fetchImpl);
    assertEquals(listed.length, 1);
    const attachment = publicAttachment("mail.png", "image/png", 3);
    const response = await downloadInboundAttachment({
      userId: "user",
      apiKey: "key",
      createdAt: new Date().toISOString(),
      channels: [],
    }, {
      provider: "resend",
      channelId: "channel",
      emailId: "email-id",
      providerAttachmentId: "att-provider",
      attachment,
    }, fetchImpl);
    assertEquals([...new Uint8Array(await response.arrayBuffer())], [9, 8, 7]);
    assertEquals(calls.length, 3);
    assertEquals(calls[2].startsWith("https://inbound-cdn.resend.com/"), true);
  } finally {
    Deno.env.delete("RESEND_API_KEY");
  }
});

Deno.test("attachment refs are bound to user, message, and attachment ids", async () => {
  const userId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const attachment = publicAttachment("x.bin", "application/octet-stream", 1);
  const ref = {
    provider: "telegram" as const,
    channelId: "channel",
    fileId: "provider-file",
    attachment,
  };
  await addInboundAttachmentRef(userId, messageId, ref);
  assertEquals(
    await getInboundAttachmentRef(userId, messageId, attachment.id),
    ref,
  );
  assertEquals(
    await getInboundAttachmentRef("other-user", messageId, attachment.id),
    undefined,
  );
  assertEquals(
    await getInboundAttachmentRef(userId, "other-message", attachment.id),
    undefined,
  );
  assertEquals(
    await getInboundAttachmentRef(userId, messageId, "other-attachment"),
    undefined,
  );
});
