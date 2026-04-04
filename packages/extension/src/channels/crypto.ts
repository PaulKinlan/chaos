// ECDSA P-256 keypair management and request signing for relay authentication
// Uses Web Crypto API (crypto.subtle) which is available in chrome-extension:// contexts

export interface KeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

const KEYPAIR_STORAGE_KEY = 'chaos-relay-keypair';
const SERVER_PUBLIC_KEY_STORAGE_KEY = 'chaos-relay-server-public-key';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

/**
 * Generate a new ECDSA P-256 keypair using crypto.subtle.
 * Keys are extractable so they can be stored as JWK in chrome.storage.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    ALGORITHM,
    true, // extractable — needed to export and store in chrome.storage
    ['sign', 'verify'],
  );

  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  return { privateKey, publicKey };
}

/**
 * Store keypair in chrome.storage.local
 */
export async function storeKeyPair(keyPair: KeyPair): Promise<void> {
  await chrome.storage.local.set({ [KEYPAIR_STORAGE_KEY]: keyPair });
}

/**
 * Load keypair from chrome.storage.local
 */
export async function loadKeyPair(): Promise<KeyPair | null> {
  const result = await chrome.storage.local.get(KEYPAIR_STORAGE_KEY);
  return result[KEYPAIR_STORAGE_KEY] || null;
}

/**
 * Store the server's public key (received during registration)
 */
export async function storeServerPublicKey(publicKey: JsonWebKey): Promise<void> {
  await chrome.storage.local.set({ [SERVER_PUBLIC_KEY_STORAGE_KEY]: publicKey });
}

/**
 * Load the server's public key
 */
export async function loadServerPublicKey(): Promise<JsonWebKey | null> {
  const result = await chrome.storage.local.get(SERVER_PUBLIC_KEY_STORAGE_KEY);
  return result[SERVER_PUBLIC_KEY_STORAGE_KEY] || null;
}

/**
 * Import a JWK private key for signing
 */
async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']);
}

/**
 * Sign a request: creates the ECDSA-SHA256 signature over timestamp|nonce|path|bodyHash
 * Returns a base64-encoded signature string.
 */
export async function signRequest(
  privateKey: JsonWebKey,
  timestamp: string,
  nonce: string,
  path: string,
  body: string,
): Promise<string> {
  const cryptoKey = await importPrivateKey(privateKey);

  // Hash the body with SHA-256
  const bodyBytes = new TextEncoder().encode(body);
  const bodyHashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHash = bufferToHex(bodyHashBuffer);

  // Build the signing payload: timestamp|nonce|path|bodyHash
  const payload = `${timestamp}|${nonce}|${path}|${bodyHash}`;
  const payloadBytes = new TextEncoder().encode(payload);

  const signature = await crypto.subtle.sign(SIGN_ALGORITHM, cryptoKey, payloadBytes);

  return bufferToBase64(signature);
}

/**
 * Generate a random nonce (16 bytes, hex-encoded)
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer as ArrayBuffer);
}

// ── Utility functions ──

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
