// ECDSA P-256 signature verification and crypto utilities for the relay server
// Handles request signature verification, nonce tracking, and body hashing

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const VERIFY_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

// Default max age for timestamps: 5 minutes
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

import { isKvAvailable, kvGetServerKeyPair, kvSetServerKeyPair } from "./kv.ts";
import { logger } from "./logger.ts";

// Server keypair — persisted in KV, cached in memory
let serverKeyPair: { privateKey: CryptoKey; publicKey: CryptoKey } | null =
  null;
let serverPublicKeyJwk: JsonWebKey | null = null;

let initPromise: Promise<void> | null = null;

/**
 * Ensure server keypair is loaded. Lazy — only runs on first call.
 * Safe to call multiple times (deduplicates).
 */
export async function ensureServerKeyPair(): Promise<void> {
  if (serverKeyPair) return; // Already loaded
  if (!initPromise) initPromise = doInitServerKeyPair();
  return initPromise;
}

/**
 * Initialize the server keypair. Loads from KV if available, otherwise generates a new one.
 */
async function doInitServerKeyPair(): Promise<void> {
  // Try to load from KV first
  if (isKvAvailable()) {
    const stored = await kvGetServerKeyPair();
    if (stored) {
      logger.info("crypto", "Loaded server keypair from KV");
      serverKeyPair = {
        privateKey: await crypto.subtle.importKey(
          "jwk",
          stored.privateKey,
          ALGORITHM,
          true,
          ["sign"],
        ),
        publicKey: await crypto.subtle.importKey(
          "jwk",
          stored.publicKey,
          ALGORITHM,
          true,
          ["verify"],
        ),
      };
      serverPublicKeyJwk = stored.publicKey;
      return;
    }
  }

  // Generate a new keypair
  serverKeyPair = await crypto.subtle.generateKey(
    ALGORITHM,
    true, // extractable for JWK export
    ["sign", "verify"],
  );
  serverPublicKeyJwk = await crypto.subtle.exportKey(
    "jwk",
    serverKeyPair.publicKey,
  );

  // Persist to KV
  if (isKvAvailable()) {
    const privateKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      serverKeyPair.privateKey,
    );
    await kvSetServerKeyPair({
      privateKey: privateKeyJwk,
      publicKey: serverPublicKeyJwk!,
    });
    logger.info("crypto", "Generated and persisted new server keypair to KV");
  } else {
    logger.warn("crypto", "Generated server keypair (in-memory only, no KV)");
  }
}

/**
 * Get the server's public key as JWK (for registration responses).
 * Lazy — triggers keypair init if not yet loaded.
 */
export async function getServerPublicKey(): Promise<JsonWebKey | null> {
  await ensureServerKeyPair();
  return serverPublicKeyJwk;
}

/**
 * Import a JWK public key for verification
 */
async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ALGORITHM, false, ["verify"]);
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

    return crypto.subtle.verify(
      VERIFY_ALGORITHM,
      cryptoKey,
      signatureBytes,
      payloadBytes,
    );
  } catch {
    return false;
  }
}

/**
 * Check timestamp freshness. Rejects timestamps older than maxAgeMs (default 5 minutes).
 */
export function isTimestampFresh(
  timestamp: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): boolean {
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
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(hashBuffer);
}

// ── Utility functions ──

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Token encryption ──
// Encrypt sensitive data (bot tokens) at rest using AES-GCM
// The encryption key is derived from CHAOS_ENCRYPTION_KEY env var or a generated one

let encryptionKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;

  const envKey = (typeof Deno !== "undefined")
    ? Deno.env.get("CHAOS_ENCRYPTION_KEY")
    : undefined;

  if (envKey) {
    // Derive key from env var using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(envKey),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    encryptionKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("chaos-relay-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } else {
    // Generate a random key (will be lost on restart — for dev only)
    encryptionKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  return encryptionKey;
}

/** Encrypt a string (e.g. a bot token). Returns base64-encoded iv:ciphertext. */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}:${ctB64}`;
}

/** Decrypt a string previously encrypted with encryptToken. */
export async function decryptToken(encrypted: string): Promise<string> {
  const key = await getEncryptionKey();
  const [ivB64, ctB64] = encrypted.split(":");
  const iv = base64ToBuffer(ivB64);
  const ciphertext = base64ToBuffer(ctB64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
