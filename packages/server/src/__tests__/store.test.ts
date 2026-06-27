// Unit tests for store helpers.
// Run with: deno test --allow-all

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fitMessageForKv, type StoredMessage } from "../store.ts";

const KV_MAX_VALUE_BYTES = 65536;

function baseMsg(content: string): StoredMessage {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    userId: "user-1",
    channelType: "email",
    channelId: "chan-1",
    from: "sender@example.com",
    content,
    timestamp: "2026-06-27T21:25:04.000Z",
    metadata: { subject: "Hello", threadId: "t1" },
  };
}

Deno.test("fitMessageForKv leaves a small message untouched", () => {
  const msg = baseMsg("a short body");
  const out = fitMessageForKv(msg);
  assertEquals(out, msg);
  assertEquals(out.metadata?.truncated, undefined);
});

Deno.test("fitMessageForKv truncates an oversized body to fit the KV limit", () => {
  const huge = "x".repeat(200_000); // ~200KB, well over the 64KB cap
  const out = fitMessageForKv(baseMsg(huge));

  // The whole serialized record must now fit under the KV value limit.
  const serializedBytes = new TextEncoder().encode(JSON.stringify(out)).length;
  assert(
    serializedBytes < KV_MAX_VALUE_BYTES,
    `expected < ${KV_MAX_VALUE_BYTES}, got ${serializedBytes}`,
  );

  assertEquals(out.metadata?.truncated, true);
  assertEquals(out.metadata?.originalContentBytes, 200_000);
  assert(out.content.endsWith("too large to deliver in full.]"));
});

Deno.test("fitMessageForKv truncates on a multibyte boundary without throwing", () => {
  // Emoji are 4 bytes each in UTF-8; a byte-slice may split one — must not throw.
  const huge = "😀".repeat(40_000); // ~160KB
  const out = fitMessageForKv(baseMsg(huge));
  const serializedBytes = new TextEncoder().encode(JSON.stringify(out)).length;
  assert(serializedBytes < KV_MAX_VALUE_BYTES);
  assertEquals(out.metadata?.truncated, true);
});
