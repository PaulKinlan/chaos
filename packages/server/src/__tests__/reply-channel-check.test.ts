// checkReplyChannel: the journal-xk4 guard — a reply must name a registered
// channel before anything is stored or sent, and success resolves to the
// channel identity the relay actually dispatched to.
import { assert, assertEquals } from "jsr:@std/assert";
import type { ChannelConfig } from "@chaos/shared";
import { channelLabel, checkReplyChannel } from "../channels/responder.ts";

function ch(over: Partial<ChannelConfig>): ChannelConfig {
  return {
    id: "ch-1",
    type: "webhook",
    direction: "bidirectional",
    agentId: "",
    enabled: true,
    metadata: {},
    ...over,
  };
}

Deno.test("checkReplyChannel", async (t) => {
  await t.step("unknown channelId is refused and names the id", () => {
    const res = checkReplyChannel(
      [ch({ id: "real", type: "telegram" })],
      { channelType: "telegram", channelId: "typo-426c" },
    );
    assertEquals(res.ok, false);
    if (!res.ok) {
      assert(res.error.includes("typo-426c"), "must name the unknown id");
      assert(res.error.includes("real"), "must list the registered channel");
      assert(res.error.includes("Refused"), "must say nothing was sent");
    }
  });

  await t.step("no channels at all is refused with a bare reason", () => {
    const res = checkReplyChannel([], {
      channelType: "telegram",
      channelId: "x",
    });
    assertEquals(res.ok, false);
    if (!res.ok) {
      assert(res.error.includes("no registered channels"));
    }
  });

  await t.step("type mismatch is refused naming both types", () => {
    const res = checkReplyChannel(
      [ch({ id: "wh", type: "webhook" })],
      { channelType: "telegram", channelId: "wh" },
    );
    assertEquals(res.ok, false);
    if (!res.ok) {
      assert(res.error.includes('"telegram"'), "names requested type");
      assert(res.error.includes('"webhook"'), "names actual type");
    }
  });

  await t.step("matching id and type resolves the channel", () => {
    const res = checkReplyChannel(
      [ch({ id: "wh", type: "webhook", name: "Deploys" })],
      { channelType: "webhook", channelId: "wh" },
    );
    assert(res.ok);
    assertEquals(res.channel.id, "wh");
    assertEquals(res.channel.type, "webhook");
    assertEquals(res.channel.label, "Deploys");
  });

  await t.step("absent channelType skips the mismatch check", () => {
    const res = checkReplyChannel(
      [ch({
        id: "tg",
        type: "telegram",
        metadata: { botUsername: "paul_bot" },
      })],
      { channelType: "", channelId: "tg" },
    );
    assert(res.ok);
    assertEquals(res.channel.type, "telegram");
    assertEquals(res.channel.label, "@paul_bot");
  });

  await t.step("label prefers name + handle, falls back to the id", () => {
    assertEquals(
      channelLabel(ch({ name: "Alerts", metadata: { botUsername: "bot" } })),
      "Alerts (@bot)",
    );
    assertEquals(
      channelLabel(ch({ metadata: { inboundAddress: "a@relay.example" } })),
      "a@relay.example",
    );
    assertEquals(channelLabel(ch({ id: "plain-id" })), "plain-id");
  });
});
