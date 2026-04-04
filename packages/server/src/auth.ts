// Authentication and request signature verification
// Phase 2: API key auth + ECDSA P-256 request signing

import type { ChannelConfig } from '@chaos/shared';
import { verifyRequestSignature, isTimestampFresh, NonceTracker, hashBody } from './crypto.ts';

export interface UserSession {
  userId: string;
  apiKey: string;
  publicKey?: JsonWebKey;  // stored during registration
  createdAt: string;
  channels: ChannelConfig[];
}

export interface AuthResult {
  session: UserSession;
  verified: boolean;  // true if signature was valid
}

// apiKey -> session
const sessions: Map<string, UserSession> = new Map();

// userId -> apiKey (reverse lookup)
const userIndex: Map<string, string> = new Map();

// Nonce tracker for replay protection
const nonceTracker = new NonceTracker();

/**
 * Validate auth and optionally verify request signature.
 *
 * For backwards compatibility: if no signature headers are present,
 * the request is still allowed but `verified` is false.
 */
export async function validateAuth(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const apiKey = match[1];
  const session = sessions.get(apiKey);
  if (!session) return null;

  // Check for signature headers
  const timestamp = req.headers.get('X-Timestamp');
  const nonce = req.headers.get('X-Nonce');
  const signature = req.headers.get('X-Signature');

  // If no signature headers, allow but mark as unverified
  if (!timestamp || !nonce || !signature) {
    if (session.publicKey) {
      // Client registered with a public key but isn't signing — warn
      console.warn(`[auth] Request from user ${session.userId} missing signature headers`);
    }
    return { session, verified: false };
  }

  // Verify the signature
  if (!session.publicKey) {
    // No public key stored — can't verify
    console.warn(`[auth] User ${session.userId} sent signature but has no stored public key`);
    return { session, verified: false };
  }

  // Check timestamp freshness (< 5 minutes)
  if (!isTimestampFresh(timestamp)) {
    console.warn(`[auth] Stale timestamp from user ${session.userId}: ${timestamp}`);
    return null; // reject stale requests
  }

  // Check nonce hasn't been used
  if (!nonceTracker.check(nonce)) {
    console.warn(`[auth] Replay detected from user ${session.userId}: nonce ${nonce}`);
    return null; // reject replayed requests
  }

  // Compute body hash
  const url = new URL(req.url);
  const path = url.pathname;

  // Read body for hash — we need to clone since body can only be read once
  let bodyText = '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // The body has likely already been consumed or will be consumed by the handler.
    // We need the body hash that the client computed. For verification, we recompute
    // from the body the client sent. The caller must pass the body text.
    // For now, we use the body hash from the request header if available,
    // or hash an empty string for GET requests.
    try {
      bodyText = await req.clone().text();
    } catch {
      bodyText = '';
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
    console.warn(`[auth] Invalid signature from user ${session.userId}`);
    return null; // reject invalid signatures
  }

  return { session, verified: true };
}

/**
 * Create a new session, optionally storing a public key.
 */
export function createSession(publicKey?: JsonWebKey): { userId: string; apiKey: string } {
  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const session: UserSession = {
    userId,
    apiKey,
    publicKey,
    createdAt: new Date().toISOString(),
    channels: [],
  };

  sessions.set(apiKey, session);
  userIndex.set(userId, apiKey);

  return { userId, apiKey };
}

export function getSessionByUserId(userId: string): UserSession | null {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return null;
  return sessions.get(apiKey) || null;
}

export function getSessionByChannelId(channelId: string): UserSession | null {
  for (const session of sessions.values()) {
    if (session.channels.some((ch) => ch.id === channelId)) {
      return session;
    }
  }
  return null;
}

export function addChannel(userId: string, channel: ChannelConfig): void {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return;
  const session = sessions.get(apiKey);
  if (!session) return;
  session.channels.push(channel);
}

export function removeChannel(userId: string, channelId: string): boolean {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return false;
  const session = sessions.get(apiKey);
  if (!session) return false;
  const idx = session.channels.findIndex((ch) => ch.id === channelId);
  if (idx === -1) return false;
  session.channels.splice(idx, 1);
  return true;
}

export function getChannels(userId: string): ChannelConfig[] {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return [];
  const session = sessions.get(apiKey);
  if (!session) return [];
  return session.channels;
}
