// Deno KV persistence layer for the relay server
// Provides typed helpers for session CRUD and server keypair storage
// Opens KV lazily on first use — never fails at startup

import type { ChannelConfig } from "@chaos/shared";
import type { UserSession } from "./auth.ts";
import { logger } from "./logger.ts";

let kv: Deno.Kv | null = null;
let kvFailed = false;

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

// ── Session operations ──

export async function kvSetSession(
  apiKey: string,
  session: UserSession,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.set(["sessions", apiKey], session);
}

export async function kvGetSession(
  apiKey: string,
): Promise<UserSession | null> {
  const store = await getKvAsync();
  if (!store) return null;
  const result = await store.get<UserSession>(["sessions", apiKey]);
  return result.value;
}

export async function kvDeleteSession(apiKey: string): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.delete(["sessions", apiKey]);
}

// ── User index operations (userId -> apiKey reverse lookup) ──

export async function kvSetUserIndex(
  userId: string,
  apiKey: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.set(["users", userId], apiKey);
}

export async function kvGetUserIndex(userId: string): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  const result = await store.get<string>(["users", userId]);
  return result.value;
}

// ── Channel index operations (channelId -> userId lookup) ──

export async function kvSetChannelIndex(
  channelId: string,
  userId: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.set(["channels", channelId], userId);
}

export async function kvGetChannelOwner(
  channelId: string,
): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  const result = await store.get<string>(["channels", channelId]);
  return result.value;
}

export async function kvDeleteChannelIndex(channelId: string): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.delete(["channels", channelId]);
}

// ── Public key index (fingerprint -> apiKey, for session reclaim) ──

export async function kvSetPubKeyIndex(
  fingerprint: string,
  apiKey: string,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.set(["pubkeys", fingerprint], apiKey);
}

export async function kvGetPubKeyIndex(
  fingerprint: string,
): Promise<string | null> {
  const store = await getKvAsync();
  if (!store) return null;
  const result = await store.get<string>(["pubkeys", fingerprint]);
  return result.value;
}

// ── Server keypair operations ──

export interface StoredKeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export async function kvGetServerKeyPair(): Promise<StoredKeyPair | null> {
  const store = await getKvAsync();
  if (!store) return null;
  const result = await store.get<StoredKeyPair>(["server", "keypair"]);
  return result.value;
}

export async function kvSetServerKeyPair(
  keypair: StoredKeyPair,
): Promise<void> {
  const store = await getKvAsync();
  if (!store) return;
  await store.set(["server", "keypair"], keypair);
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
