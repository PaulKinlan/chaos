// Exactly-once delivery among connections sharing one identity.
import { assertEquals } from "jsr:@std/assert";
import { claimDelivery } from "../store.ts";

Deno.test("claimDelivery", async (t) => {
  const kv = await Deno.openKv(":memory:");
  try {
    await t.step("exactly one racing connection wins a message", async () => {
      const [a, b] = await Promise.all([
        claimDelivery(kv, "user1", "msg1", "connA"),
        claimDelivery(kv, "user1", "msg1", "connB"),
      ]);
      assertEquals([a, b].filter(Boolean).length, 1);
    });

    await t.step("a later claim on the same message loses", async () => {
      assertEquals(await claimDelivery(kv, "user1", "msg1", "connC"), false);
    });

    await t.step("a different message is independently claimable", async () => {
      assertEquals(await claimDelivery(kv, "user1", "msg2", "connA"), true);
    });

    await t.step("same message id, different user is independent", async () => {
      assertEquals(await claimDelivery(kv, "user2", "msg1", "connA"), true);
    });
  } finally {
    kv.close();
  }
});
