import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authedFetch,
  getBaseUrl,
  legacyAuthedFetch,
  register,
  registerLegacy,
} from "./helpers.ts";

Deno.test("inbound attachment endpoint fails closed", async (t) => {
  const base = getBaseUrl();
  const path = "/messages/unknown-message/attachments/unknown-attachment";

  await t.step("rejects unauthenticated retrieval", async () => {
    const response = await fetch(`${base}${path}`);
    assertEquals(response.status, 401);
  });

  await t.step("rejects legacy bearer-only retrieval", async () => {
    const legacy = await registerLegacy();
    const response = await legacyAuthedFetch(
      `${base}${path}`,
      { method: "GET" },
      legacy.apiKey,
    );
    assertEquals(response.status, 401);
  });

  await t.step(
    "signed unknown descriptors return 404 without provider access",
    async () => {
      const credentials = await register();
      const response = await authedFetch(
        `${base}${path}`,
        { method: "GET" },
        credentials,
      );
      assertEquals(response.status, 404);
    },
  );
});
