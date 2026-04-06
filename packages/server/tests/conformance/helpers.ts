// Conformance test helpers for the CHAOS relay server.
// These helpers are implementation-agnostic — they work against any server
// that implements the CHAOS relay protocol.

const ALGORITHM: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGORITHM: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/** Read the base URL from RELAY_URL env var, or default to localhost:8787. */
export function getBaseUrl(): string {
  return Deno.env.get("RELAY_URL") || "http://localhost:8787";
}

/** Generate an ECDSA P-256 keypair and export the public key as JWK. */
export async function generateKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
  };
}

/** Hash a string body with SHA-256 and return the hex digest. */
export async function hashBody(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Sign a request payload using ECDSA P-256.
 * The signature covers: timestamp|nonce|path|bodyHash
 */
export async function signRequest(
  privateKey: CryptoKey,
  timestamp: string,
  nonce: string,
  path: string,
  bodyHash: string,
): Promise<string> {
  const payload = `${timestamp}|${nonce}|${path}|${bodyHash}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign(
    SIGN_ALGORITHM,
    privateKey,
    payloadBytes,
  );
  return bufferToBase64(signature);
}

export interface Credentials {
  userId: string;
  apiKey: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

/**
 * Full registration flow: generate keypair, POST /auth/register, return credentials.
 * Each call creates an independent session.
 */
export async function register(): Promise<Credentials> {
  const keyPair = await generateKeyPair();
  const base = getBaseUrl();

  const resp = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: keyPair.publicKeyJwk }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Registration failed: ${resp.status} ${resp.statusText} — ${text}`,
    );
  }

  const data = await resp.json();
  return {
    userId: data.userId,
    apiKey: data.apiKey,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk: keyPair.publicKeyJwk,
  };
}

/**
 * Register without a public key (legacy mode).
 * Returns userId and apiKey only.
 */
export async function registerLegacy(): Promise<{
  userId: string;
  apiKey: string;
}> {
  const base = getBaseUrl();
  const resp = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Legacy registration failed: ${resp.status} ${resp.statusText} — ${text}`,
    );
  }
  const data = await resp.json();
  return { userId: data.userId, apiKey: data.apiKey };
}

/**
 * Make an authenticated fetch with Bearer token + ECDSA signature headers.
 * For sessions with a public key, all three signature headers are required.
 */
export async function authedFetch(
  url: string,
  options: RequestInit & { body?: string | null },
  credentials: Credentials,
): Promise<Response> {
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyText = options.body ?? "";
  const bodyHashHex = await hashBody(bodyText);

  const signature = await signRequest(
    credentials.privateKey,
    timestamp,
    nonce,
    path,
    bodyHashHex,
  );

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${credentials.apiKey}`);
  headers.set("X-Timestamp", timestamp);
  headers.set("X-Nonce", nonce);
  headers.set("X-Signature", signature);

  return fetch(url, { ...options, headers });
}

/**
 * Make an authenticated fetch for legacy sessions (Bearer token only, no signatures).
 */
export async function legacyAuthedFetch(
  url: string,
  options: RequestInit,
  apiKey: string,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  return fetch(url, { ...options, headers });
}
