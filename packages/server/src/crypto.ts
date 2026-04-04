// ECDSA P-256 signature verification and crypto utilities for the relay server
// Handles request signature verification, nonce tracking, and body hashing

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const VERIFY_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

// Default max age for timestamps: 5 minutes
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

// Server keypair — generated on startup, kept in memory
let serverKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey } | null = null;
let serverPublicKeyJwk: JsonWebKey | null = null;

/**
 * Generate the server keypair on startup. Call once at boot.
 */
export async function initServerKeyPair(): Promise<void> {
  serverKeyPair = await crypto.subtle.generateKey(
    ALGORITHM,
    true, // extractable for JWK export
    ['sign', 'verify'],
  );
  serverPublicKeyJwk = await crypto.subtle.exportKey('jwk', serverKeyPair.publicKey);
}

/**
 * Get the server's public key as JWK (for registration responses)
 */
export function getServerPublicKey(): JsonWebKey | null {
  return serverPublicKeyJwk;
}

/**
 * Import a JWK public key for verification
 */
async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify']);
}

/**
 * Verify a request signature.
 * The signature was created over: timestamp|nonce|path|bodyHash
 */
export async function verifyRequestSignature(
  publicKeyJwk: JsonWebKey,
  signature: string,
  timestamp: string,
  nonce: string,
  path: string,
  bodyHash: string,
): Promise<boolean> {
  try {
    const cryptoKey = await importPublicKey(publicKeyJwk);
    const payload = `${timestamp}|${nonce}|${path}|${bodyHash}`;
    const payloadBytes = new TextEncoder().encode(payload);
    const signatureBytes = base64ToBuffer(signature);

    return crypto.subtle.verify(VERIFY_ALGORITHM, cryptoKey, signatureBytes, payloadBytes);
  } catch {
    return false;
  }
}

/**
 * Check timestamp freshness. Rejects timestamps older than maxAgeMs (default 5 minutes).
 */
export function isTimestampFresh(timestamp: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return false;
  const now = Date.now();
  const age = Math.abs(now - ts);
  return age <= maxAgeMs;
}

/**
 * Nonce tracker — prevents replay attacks by rejecting already-seen nonces.
 * Nonces expire after the same window as timestamp freshness (5 minutes).
 */
export class NonceTracker {
  private seen: Map<string, number> = new Map(); // nonce -> timestamp (ms)
  private maxAgeMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
    this.maxAgeMs = maxAgeMs;
    // Clean up expired nonces every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a nonce is new (not seen before). Returns true if the nonce is fresh.
   */
  check(nonce: string): boolean {
    if (this.seen.has(nonce)) {
      return false; // replay detected
    }
    this.seen.set(nonce, Date.now());
    return true;
  }

  /**
   * Remove expired nonces from the tracking set
   */
  cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [nonce, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(nonce);
      }
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get the number of tracked nonces (for testing)
   */
  get size(): number {
    return this.seen.size;
  }
}

/**
 * Hash a request body using SHA-256, returns hex string
 */
export async function hashBody(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHex(hashBuffer);
}

// ── Utility functions ──

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
