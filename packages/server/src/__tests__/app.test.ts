// The admin app must never leak channel secrets to the browser.
import { assert, assertEquals } from "jsr:@std/assert";
import { maskChannel } from "../app.ts";
import type { ChannelConfig } from "@chaos/shared";

Deno.test("maskChannel redacts secret-looking metadata, keeps the rest", () => {
  const ch: ChannelConfig = {
    id: "ch1",
    name: "My bot",
    type: "telegram",
    direction: "bidirectional",
    agentId: "pi",
    enabled: true,
    metadata: {
      botToken: "123:secret-abc",
      apiKey: "sk-live-xyz",
      webhookSecret: "hunter2",
      chatId: "555",
      label: "public label",
    },
  };
  const masked = maskChannel(ch);
  const meta = masked.metadata as Record<string, unknown>;

  // Secrets redacted...
  assertEquals(meta.botToken, "••••••••");
  assertEquals(meta.apiKey, "••••••••");
  assertEquals(meta.webhookSecret, "••••••••");
  // ...non-secret values preserved.
  assertEquals(meta.chatId, "555");
  assertEquals(meta.label, "public label");
  // Identity fields kept for display.
  assertEquals(masked.id, "ch1");
  assertEquals(masked.type, "telegram");
  // No raw secret leaks anywhere in the serialised payload.
  assert(!JSON.stringify(masked).includes("secret-abc"));
  assert(!JSON.stringify(masked).includes("sk-live-xyz"));
});
