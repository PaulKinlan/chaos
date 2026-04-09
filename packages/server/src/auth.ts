// Authentication and request signature verification
// Phase 2: API key auth + ECDSA P-256 request signing
// Phase 3: Deno KV persistence with in-memory cache

import type { ChannelConfig } from "@chaos/shared";
import {
  hashBody,
  isTimestampFresh,
  NonceTracker,
  verifyRequestSignature,
} from "./crypto.ts";
import { logger } from "./logger.ts";
import {
  isKvAvailable,
  kvDeleteChannelIndex,
  kvGetChannelOwner,
  kvGetPubKeyIndex,
  kvGetSession,
  kvGetUserIndex,
  kvSetChannelIndex,
  kvSetPubKeyIndex,
  kvSetSession,
  kvSetUserIndex,
} from "./kv.ts";

export interface UserSession {
  userId: string;
  apiKey: string;
  publicKey?: JsonWebKey; // stored during registration
  createdAt: string;
  channels: ChannelConfig[];
}

export interface AuthResult {
  session: UserSession;
  verified: boolean; // true if signature was valid
}

// In-memory caches — act as primary store when KV is unavailable,
// and as a hot cache when KV is available
// apiKey -> session
const sessionCache: Map<string, UserSession> = new Map();

// userId -> apiKey (reverse lookup)
const userIndexCache: Map<string, string> = new Map();

// channelId -> userId (channel owner lookup)
const channelIndexCache: Map<string, string> = new Map();

// Nonce tracker for replay protection
const nonceTracker = new NonceTracker();

/**
 * Invalidate the in-memory cache for a session and persist to KV.
 */
async function persistSession(session: UserSession): Promise<void> {
  sessionCache.set(session.apiKey, session);
  userIndexCache.set(session.userId, session.apiKey);
  if (isKvAvailable()) {
    await kvSetSession(session.apiKey, session);
    await kvSetUserIndex(session.userId, session.apiKey);
  }
}

/**
 * Validate auth and optionally verify request signature.
 *
 * For backwards compatibility: if no signature headers are present,
 * the request is still allowed but `verified` is false.
 */
export async function validateAuth(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const apiKey = match[1];

  // Try in-memory cache first, then KV
  let session = sessionCache.get(apiKey) ?? null;
  if (!session && isKvAvailable()) {
    session = await kvGetSession(apiKey);
    if (session) {
      // Populate cache
      sessionCache.set(apiKey, session);
      userIndexCache.set(session.userId, apiKey);
      for (const ch of session.channels) {
        channelIndexCache.set(ch.id, session.userId);
      }
    }
  }
  if (!session) return null;

  // Check for signature headers
  const timestamp = req.headers.get("X-Timestamp");
  const nonce = req.headers.get("X-Nonce");
  const signature = req.headers.get("X-Signature");

  // Signature is REQUIRED when the session has a public key
  if (!timestamp || !nonce || !signature) {
    if (session.publicKey) {
      // Client registered with a public key but isn't signing — reject
      logger.warn("auth", "Request missing required signature headers", {
        userId: session.userId,
      });
      return null;
    }
    // Legacy session without public key — allow unsigned (temporary migration)
    return { session, verified: false };
  }

  // Verify the signature
  if (!session.publicKey) {
    // Signed request but no public key stored — reject
    logger.warn("auth", "Signed request but no stored public key", {
      userId: session.userId,
    });
    return null;
  }

  // Check timestamp freshness (< 5 minutes)
  if (!isTimestampFresh(timestamp)) {
    logger.warn("auth", "Stale timestamp", {
      userId: session.userId,
      timestamp,
    });
    return null; // reject stale requests
  }

  // Check nonce hasn't been used
  if (!nonceTracker.check(nonce)) {
    logger.warn("auth", "Replay detected", { userId: session.userId, nonce });
    return null; // reject replayed requests
  }

  // Compute body hash
  const url = new URL(req.url);
  const path = url.pathname;

  // Read body for hash — we need to clone since body can only be read once
  let bodyText = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      bodyText = await req.clone().text();
    } catch {
      bodyText = "";
    }
  }
  const bodyHashHex = await hashBody(bodyText);

  // Verify signature
  const verified = await verifyRequestSignature(
    session.publicKey,
    signature,
    timestamp,
    nonce,
    path,
    bodyHashHex,
  );

  if (!verified) {
    logger.warn("auth", "Invalid signature", {
      userId: session.userId,
      path,
      method: req.method,
      timestamp,
      bodyLength: bodyText.length,
      bodyHashHex: bodyHashHex.slice(0, 16) + "...",
    });
    return null; // reject invalid signatures
  }

  logger.debug("auth", "Auth successful", {
    userId: session.userId,
    verified: true,
  });
  return { session, verified: true };
}

/**
 * Compute a fingerprint of a JWK public key for indexing.
 */
function pubKeyFingerprint(publicKey: JsonWebKey): string {
  // Use the x and y coordinates of the P-256 key as a stable fingerprint
  return `${publicKey.x || ""}:${publicKey.y || ""}`;
}

/**
 * Create a new session, optionally storing a public key.
 * If a session with the same public key already exists (reclaim),
 * returns the existing session instead of creating a new one.
 */
export async function createSession(
  publicKey?: JsonWebKey,
): Promise<{ userId: string; apiKey: string }> {
  // Check if this public key already has a session (reclaim after server restart)
  if (publicKey && isKvAvailable()) {
    const fingerprint = pubKeyFingerprint(publicKey);
    const existingApiKey = await kvGetPubKeyIndex(fingerprint);
    if (existingApiKey) {
      const existingSession = await kvGetSession(existingApiKey);
      if (existingSession) {
        // Reclaim: populate caches and return existing credentials
        sessionCache.set(existingApiKey, existingSession);
        userIndexCache.set(existingSession.userId, existingApiKey);
        for (const ch of existingSession.channels) {
          channelIndexCache.set(ch.id, existingSession.userId);
        }
        logger.info("auth", "Session reclaimed", {
          userId: existingSession.userId,
          channels: existingSession.channels.length,
        });
        return { userId: existingSession.userId, apiKey: existingApiKey };
      }
    }
  }

  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const session: UserSession = {
    userId,
    apiKey,
    publicKey,
    createdAt: new Date().toISOString(),
    channels: [],
  };

  await persistSession(session);

  // Index by public key fingerprint for future reclaim
  if (publicKey && isKvAvailable()) {
    const fingerprint = pubKeyFingerprint(publicKey);
    await kvSetPubKeyIndex(fingerprint, apiKey);
  }

  logger.info("auth", "Session created", { userId, hasPublicKey: !!publicKey });
  return { userId, apiKey };
}

/**
 * Look up a session by API key (for WebSocket auth where Bearer headers aren't available).
 */
export async function getSessionByApiKey(
  apiKey: string,
): Promise<UserSession | null> {
  let session = sessionCache.get(apiKey) ?? null;
  if (!session && isKvAvailable()) {
    session = await kvGetSession(apiKey);
    if (session) {
      sessionCache.set(apiKey, session);
      userIndexCache.set(session.userId, apiKey);
      for (const ch of session.channels) {
        channelIndexCache.set(ch.id, session.userId);
      }
    }
  }
  return session;
}

export async function getSessionByUserId(
  userId: string,
): Promise<UserSession | null> {
  // Try cache first
  let apiKey = userIndexCache.get(userId) ?? null;
  if (!apiKey && isKvAvailable()) {
    apiKey = await kvGetUserIndex(userId);
    if (apiKey) {
      userIndexCache.set(userId, apiKey);
    }
  }
  if (!apiKey) return null;

  let session = sessionCache.get(apiKey) ?? null;
  if (!session && isKvAvailable()) {
    session = await kvGetSession(apiKey);
    if (session) {
      sessionCache.set(apiKey, session);
      for (const ch of session.channels) {
        channelIndexCache.set(ch.id, session.userId);
      }
    }
  }
  return session;
}

export async function getSessionByChannelId(
  channelId: string,
): Promise<UserSession | null> {
  // Try channel index cache first
  let userId = channelIndexCache.get(channelId) ?? null;
  if (!userId && isKvAvailable()) {
    userId = await kvGetChannelOwner(channelId);
    if (userId) {
      channelIndexCache.set(channelId, userId);
    }
  }
  if (!userId) return null;

  return getSessionByUserId(userId);
}

export async function addChannel(
  userId: string,
  channel: ChannelConfig,
): Promise<void> {
  const session = await getSessionByUserId(userId);
  if (!session) return;
  session.channels.push(channel);

  // Update channel index
  channelIndexCache.set(channel.id, userId);
  if (isKvAvailable()) {
    await kvSetChannelIndex(channel.id, userId);
  }

  // Persist updated session
  await persistSession(session);
}

export async function removeChannel(
  userId: string,
  channelId: string,
): Promise<boolean> {
  const session = await getSessionByUserId(userId);
  if (!session) return false;
  const idx = session.channels.findIndex((ch) => ch.id === channelId);
  if (idx === -1) return false;
  session.channels.splice(idx, 1);

  // Remove channel index
  channelIndexCache.delete(channelId);
  if (isKvAvailable()) {
    await kvDeleteChannelIndex(channelId);
  }

  // Persist updated session
  await persistSession(session);
  return true;
}

export async function updateChannelMetadata(
  userId: string,
  channelId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const session = await getSessionByUserId(userId);
  if (!session) return;
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel) return;
  channel.metadata = metadata;
  await persistSession(session);
}

export async function getChannels(userId: string): Promise<ChannelConfig[]> {
  const session = await getSessionByUserId(userId);
  if (!session) return [];
  return session.channels;
}

/**
 * Get all cached sessions (in-memory only, no KV scan).
 * Fast path for admin dashboard — returns what's in memory.
 */
export function getCachedSessions(): UserSession[] {
  return Array.from(sessionCache.values());
}
