// Attachment validation for outbound replies (pass-through, never stored).
import { assertEquals } from "jsr:@std/assert";
import {
  decodeAttachment,
  validateAttachments,
} from "../channels/responder.ts";

Deno.test("validateAttachments", async (t) => {
  await t.step("undefined is fine (no attachments)", () => {
    assertEquals(validateAttachments(undefined), null);
  });

  await t.step("a valid image attachment passes", () => {
    assertEquals(
      validateAttachments([{
        filename: "chart.png",
        mimeType: "image/png",
        dataBase64: btoa("hello"),
      }]),
      null,
    );
  });

  await t.step("non-array rejected", () => {
    assertEquals(typeof validateAttachments("nope"), "string");
  });

  await t.step("too many attachments rejected", () => {
    const a = {
      filename: "a.png",
      mimeType: "image/png",
      dataBase64: btoa("x"),
    };
    assertEquals(typeof validateAttachments([a, a, a, a]), "string");
  });

  await t.step("path traversal in filename rejected", () => {
    assertEquals(
      typeof validateAttachments([{
        filename: "../../etc/passwd",
        mimeType: "image/png",
        dataBase64: btoa("x"),
      }]),
      "string",
    );
  });

  await t.step("bad mime rejected", () => {
    assertEquals(
      typeof validateAttachments([{
        filename: "a.png",
        mimeType: "not a mime",
        dataBase64: btoa("x"),
      }]),
      "string",
    );
  });

  await t.step("oversize rejected without decoding", () => {
    // ~6MB of base64 (8M chars) — must be rejected by length arithmetic.
    const big = "A".repeat(8 * 1024 * 1024);
    assertEquals(
      typeof validateAttachments([{
        filename: "big.bin",
        mimeType: "application/octet-stream",
        dataBase64: big,
      }]),
      "string",
    );
  });
});

Deno.test("decodeAttachment round-trips bytes", () => {
  const bytes = decodeAttachment({
    filename: "t.txt",
    mimeType: "text/plain",
    dataBase64: btoa("chaos"),
  });
  assertEquals(new TextDecoder().decode(bytes), "chaos");
});
