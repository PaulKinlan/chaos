// Deno KV persistence layer for the relay server
// Provides typed helpers for session CRUD and server keypair storage
// Opens KV lazily on first use — never fails at startup
//
// Every KV operation is instrumented (instrumentKv): timed, slow ops warned,
// errors logged with context, and bounded by a hard timeout so a wedged KV
// Connect surfaces as a fast, logged failure instead of a silent hang (which is
// exactly the failure mode that took the relay down — register stalled forever
// on a KV write while the only error signal lived in Deno's infra logs, not
// ours). Rolling counters + last error are exposed via kvStats() so /health can
// show KV health at a glance, and kvHealthCheck() does a live round-trip on
// demand (GET /health?deep=1).

import type { ChannelConfig } from "@chaos/shared";
import type { UserSession } from "./auth.ts";
import { logger } from "./logger.ts";

let kv: Deno.Kv | null = null;
let kvFailed = false;

// ── Instrumentation ──

// A KV op that takes longer than this is almost certainly a stalled KV Connect;
// fail fast and visibly instead of hanging the request. Tunable via env.
const KV_TIMEOUT_MS = Number(Deno.env.get("KV_TIMEOUT_MS") || "5000");
const KV_SLOW_MS = Number(Deno.env.get("KV_SLOW_MS") || "1000");

let opsTotal = 0;
let errorsTotal = 0;
let timeoutsTotal = 0;
let lastError:
  | { op: string; error: string; ms: number; at: string }
  | null = null;

export class KvTimeoutError extends Error {
  constructor(op: string, ms: number) {
    super(`KV op "${op}" timed out after ${ms}ms`);
    this.name = "KvTimeoutError";
  }
}

/** Rolling KV health counters for /health — in-memory, instant. */
export function kvStats(): {
  ops: number;
  errors: number;
  timeouts: number;
  lastError: { op: string; error: string; ms: number; at: string } | null;
} {
  return {
    ops: opsTotal,
    errors: errorsTotal,
    timeouts: timeoutsTotal,
    lastError,
  };
}

/**
 * Run a single KV operation with timing, slow-op warnings, error logging, and a
 * hard timeout. On timeout or error it records the failure (counters + last
 * error for /health), logs with context, and rethrows — so the caller fails
 * fast and visibly instead of hanging on a stalled KV Connect.
 */
export async function instrumentKv<T>(
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  opsTotal++;
  const t = performance.now();
  let timer: number | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new KvTimeoutError(op, KV_TIMEOUT_MS)),
          KV_TIMEOUT_MS,
        );
      }),
    ]);
    const ms = Math.round(performance.now() - t);
    if (ms >= KV_SLOW_MS) {
      logger.warn("kv", "Slow KV op", { op, ms });
    }
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t);
    errorsTotal++;
    if (err instanceof KvTimeoutError) timeoutsTotal++;
    lastError = { op, error: String(err), ms, at: new Date().toISOString() };
    logger.error("kv", "KV op failed", { op, ms, error: String(err) });
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Get the KV instance, opening it lazily on first call.
 * Returns null if KV is not available (e.g., tests, or after a failure).
 */
export async function getKvAsync(): Promise<Deno.Kv | null> {
  if (kv) return kv;
  if (kvFailed) return null;

  try {
    const t = performance.now();
    kv = await Deno.openKv();
    logger.info("kv", "Deno KV store opened", {
      ms: Math.round(performance.now() - t),
    });
    return kv;
  } catch (err) {
    kvFailed = true;
    logger.warn("kv", "Deno KV not available, using in-memory fallback", {
      error: String(err),
    });
    return null;
  }
}

/**
 * Initialize KV eagerly. Used at startup to warm caches.
 * Non-fatal — server continues without KV if it fails.
 */
export async function initKv(): Promise<void> {
  await getKvAsync();
}

/**
 * Check if KV is available (synchronous — only true after successful open)
 */
export function isKvAvailable(): boolean {
  return kv !== null;
}

/**
 * Get the KV instance synchronously (returns null if not opened yet).
 * Prefer getKvAsync() for new code.
 */
export function getKv(): Deno.Kv | null {
  return kv;
}

/**
 * Live KV round-trip (write + read back), bounded by the op timeout. Use for an
 * on-demand health probe — unlike isKvAvailable() (which only reports whether
 * the store opened once at boot), this proves writes actually work right now.
 */
export async function kvHealthCheck(): Promise<
  { ok: boolean; ms: number; error?: string }
> {
  const store = await getKvAsync();
  if (!store) return { ok: false, ms: 0, error: "kv unavailable" };
  const t = performance.now();
  try {
    await instrumentKv("healthCheck", async () => {
      await store.set(["health", "ping"], Date.now());
      const r = await store.get<number>(["health", "ping"]);
      if (!r.value) throw new Error("ping readback empty");
    });
    return { ok: true, ms: Math.round(performance.now() - t) };
  } catch (err) {
    return {
      ok: false,
      ms: Math.round(performance.now() - t),
      error: String(err),
    };
  }
}

// ── Session operations ──

export async function kvSetSession(
  apiKey: string,
  session: UserSession,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "setSession",
    () => store.set(["sessions", apiKey], session),
  );
}

export async function kvGetSession(
  apiKey: string,
): Promise<UserSession | null> {
  const store = await getKvAsync();
  if (!store) return null;
  return instrumentKv(
    "getSession",
    async () => (await store.get<UserSession>(["sessions", apiKey])).value,
  );
}

export async function kvDeleteSession(apiKey: string): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv("deleteSession", () => store.delete(["sessions", apiKey]));
}

// ── User index operations (userId -> apiKey reverse lookup) ──

export async function kvSetUserIndex(
  userId: string,
  apiKey: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "setUserIndex",
    () => store.set(["users", userId], apiKey),
  );
}

export async function kvGetUserIndex(userId: string): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  return instrumentKv(
    "getUserIndex",
    async () => (await store.get<string>(["users", userId])).value,
  );
}

// ── Channel index operations (channelId -> userId lookup) ──

export async function kvSetChannelIndex(
  channelId: string,
  userId: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "setChannelIndex",
    () => store.set(["channels", channelId], userId),
  );
}

export async function kvGetChannelOwner(
  channelId: string,
): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  return instrumentKv(
    "getChannelOwner",
    async () => (await store.get<string>(["channels", channelId])).value,
  );
}

export async function kvDeleteChannelIndex(channelId: string): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "deleteChannelIndex",
    () => store.delete(["channels", channelId]),
  );
}

// ── Public key index (fingerprint -> apiKey, for session reclaim) ──

export async function kvSetPubKeyIndex(
  fingerprint: string,
  apiKey: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "setPubKeyIndex",
    () => store.set(["pubkeys", fingerprint], apiKey),
  );
}

export async function kvGetPubKeyIndex(
  fingerprint: string,
): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  return instrumentKv(
    "getPubKeyIndex",
    async () => (await store.get<string>(["pubkeys", fingerprint])).value,
  );
}

// ── Server keypair operations ──

export interface StoredKeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export async function kvGetServerKeyPair(): Promise<StoredKeyPair | null> {
  const store = await getKvAsync();
  if (!store) return null;
  return instrumentKv(
    "getServerKeyPair",
    async () => (await store.get<StoredKeyPair>(["server", "keypair"])).value,
  );
}

export async function kvSetServerKeyPair(
  keypair: StoredKeyPair,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await instrumentKv(
    "setServerKeyPair",
    () => store.set(["server", "keypair"], keypair),
  );
}

/**
 * Close the KV store (for graceful shutdown)
 */
export function closeKv(): void {
  if (kv) {
    kv.close();
    kv = null;
  }
}
