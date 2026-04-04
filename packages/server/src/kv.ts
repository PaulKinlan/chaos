// Deno KV persistence layer for the relay server
// Provides typed helpers for session CRUD and server keypair storage
// Falls back to in-memory storage when KV is unavailable (e.g., tests)

import type { ChannelConfig } from '@chaos/shared';
import type { UserSession } from './auth.ts';
import { logger } from './logger.ts';

let kv: Deno.Kv | null = null;
let kvAvailable = true;

/**
 * Initialize the KV store. Call once at startup.
 * If Deno KV is not available, falls back to in-memory mode.
 */
export async function initKv(): Promise<void> {
  try {
    kv = await Deno.openKv();
    logger.info('kv', 'Deno KV store opened');
  } catch (err) {
    kvAvailable = false;
    logger.warn('kv', 'Deno KV not available, using in-memory fallback', { error: String(err) });
  }
}

/**
 * Check if KV is available
 */
export function isKvAvailable(): boolean {
  return kvAvailable && kv !== null;
}

/**
 * Get the KV instance (or null if not available)
 */
export function getKv(): Deno.Kv | null {
  return kv;
}

// ── Session operations ──

export async function kvSetSession(apiKey: string, session: UserSession): Promise<void> {
  if (!kv) return;
  await kv.set(['sessions', apiKey], session);
}

export async function kvGetSession(apiKey: string): Promise<UserSession | null> {
  if (!kv) return null;
  const result = await kv.get<UserSession>(['sessions', apiKey]);
  return result.value;
}

export async function kvDeleteSession(apiKey: string): Promise<void> {
  if (!kv) return;
  await kv.delete(['sessions', apiKey]);
}

// ── User index operations (userId -> apiKey reverse lookup) ──

export async function kvSetUserIndex(userId: string, apiKey: string): Promise<void> {
  if (!kv) return;
  await kv.set(['users', userId], apiKey);
}

export async function kvGetUserIndex(userId: string): Promise<string | null> {
  if (!kv) return null;
  const result = await kv.get<string>(['users', userId]);
  return result.value;
}

// ── Channel index operations (channelId -> userId lookup) ──

export async function kvSetChannelIndex(channelId: string, userId: string): Promise<void> {
  if (!kv) return;
  await kv.set(['channels', channelId], userId);
}

export async function kvGetChannelOwner(channelId: string): Promise<string | null> {
  if (!kv) return null;
  const result = await kv.get<string>(['channels', channelId]);
  return result.value;
}

export async function kvDeleteChannelIndex(channelId: string): Promise<void> {
  if (!kv) return;
  await kv.delete(['channels', channelId]);
}

// ── Public key index (fingerprint -> apiKey, for session reclaim) ──

export async function kvSetPubKeyIndex(fingerprint: string, apiKey: string): Promise<void> {
  if (!kv) return;
  await kv.set(['pubkeys', fingerprint], apiKey);
}

export async function kvGetPubKeyIndex(fingerprint: string): Promise<string | null> {
  if (!kv) return null;
  const result = await kv.get<string>(['pubkeys', fingerprint]);
  return result.value;
}

// ── Server keypair operations ──

export interface StoredKeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export async function kvGetServerKeyPair(): Promise<StoredKeyPair | null> {
  if (!kv) return null;
  const result = await kv.get<StoredKeyPair>(['server', 'keypair']);
  return result.value;
}

export async function kvSetServerKeyPair(keypair: StoredKeyPair): Promise<void> {
  if (!kv) return;
  await kv.set(['server', 'keypair'], keypair);
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
