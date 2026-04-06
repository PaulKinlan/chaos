// Conformance tests: GET /health
// Verifies the health endpoint returns expected status and version info.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getBaseUrl } from "./helpers.ts";

Deno.test("GET /health returns 200 with status ok and version", async () => {
  const base = getBaseUrl();
  const resp = await fetch(`${base}/health`);
  assertEquals(resp.status, 200);

  const data = await resp.json();
  assertEquals(data.status, "ok");
  assertExists(data.version, "response should include a version field");
  assertEquals(typeof data.version, "string");
});

Deno.test("GET /health includes kv and websockets fields", async () => {
  const base = getBaseUrl();
  const resp = await fetch(`${base}/health`);
  assertEquals(resp.status, 200);

  const data = await resp.json();
  assertEquals(typeof data.kv, "boolean");
  assertEquals(typeof data.websockets, "number");
  assertEquals(typeof data.uptime, "number");
});
