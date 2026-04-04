// HTTP client for the CHAOS relay server
// Uses ECDSA P-256 request signing for authentication

import type { ChannelResponse, ChannelConfig, RelayPollResponse } from './types.js';
import {
  generateKeyPair,
  storeKeyPair,
  loadKeyPair,
  signRequest,
  generateNonce,
  storeServerPublicKey,
} from './crypto.js';

export interface RelayConfig {
  serverUrl: string;
  apiKey: string;
}

/**
 * Signed fetch wrapper — adds ECDSA signature headers to every request.
 *
 * Headers added:
 *   X-Timestamp: ISO 8601 timestamp
 *   X-Nonce: random 16 bytes hex
 *   X-Signature: base64-encoded ECDSA-SHA256 signature
 *   Authorization: Bearer {apiKey}
 */
/**
 * Validate that the relay URL uses HTTPS (except localhost for dev).
 */
function enforceHttps(url: string): void {
  const parsed = new URL(url);
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !isLocalhost) {
    throw new Error(`Relay server must use HTTPS. Got: ${parsed.protocol}//${parsed.hostname}. Only localhost is exempt for development.`);
  }
}

async function signedFetch(
  url: string,
  options: RequestInit & { relayConfig: RelayConfig },
): Promise<Response> {
  enforceHttps(url);
  const { relayConfig, ...fetchOptions } = options;
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;

  // Prepare headers — only set Content-Type when there's a body
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${relayConfig.apiKey}`,
    ...(fetchOptions.headers as Record<string, string> || {}),
  };
  if (fetchOptions.body) {
    headers['Content-Type'] = 'application/json';
  }

  // Try to load keypair and sign
  const keyPair = await loadKeyPair();
  if (keyPair) {
    const timestamp = new Date().toISOString();
    const nonce = generateNonce();
    const body = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';

    const signature = await signRequest(
      keyPair.privateKey,
      timestamp,
      nonce,
      path,
      body,
    );

    headers['X-Timestamp'] = timestamp;
    headers['X-Nonce'] = nonce;
    headers['X-Signature'] = signature;
  }

  return fetch(url, {
    ...fetchOptions,
    headers,
  });
}

/**
 * Internal helper for authenticated relay requests
 */
async function relayFetch(
  config: RelayConfig,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${config.serverUrl.replace(/\/$/, '')}${path}`;
  return signedFetch(url, {
    ...options,
    relayConfig: config,
  });
}

/**
 * Register with the relay server.
 * Generates a keypair if none exists, sends the public key, and stores credentials.
 */
export async function registerWithRelay(
  serverUrl: string,
): Promise<{ userId: string; apiKey: string }> {
  // Generate keypair if none exists
  let keyPair = await loadKeyPair();
  if (!keyPair) {
    keyPair = await generateKeyPair();
    await storeKeyPair(keyPair);
  }

  const url = `${serverUrl.replace(/\/$/, '')}/auth/register`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: keyPair.publicKey }),
  });
  if (!resp.ok) {
    throw new Error(`Registration failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();

  // Store the server's public key if provided (TOFU — Trust On First Use)
  if (data.serverPublicKey) {
    await storeServerPublicKey(data.serverPublicKey);
  }

  return { userId: data.userId, apiKey: data.apiKey };
}

export async function pollMessages(
  config: RelayConfig,
  since: string,
): Promise<RelayPollResponse> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const resp = await relayFetch(config, `/messages${params}`);
  if (!resp.ok) {
    throw new Error(`Poll failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

export async function sendReply(
  config: RelayConfig,
  reply: ChannelResponse,
): Promise<void> {
  const resp = await relayFetch(config, '/reply', {
    method: 'POST',
    body: JSON.stringify(reply),
  });
  if (!resp.ok) {
    throw new Error(`Reply failed: ${resp.status} ${resp.statusText}`);
  }
}

export async function registerChannel(
  config: RelayConfig,
  channel: Partial<ChannelConfig>,
): Promise<{ channel: ChannelConfig; webhookUrl?: string }> {
  const resp = await relayFetch(config, '/channels', {
    method: 'POST',
    body: JSON.stringify(channel),
  });
  if (!resp.ok) {
    throw new Error(`Channel registration failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

export async function registerTelegramChannel(
  config: RelayConfig,
  botToken: string,
  agentId?: string,
): Promise<{ channelId: string; botUsername: string }> {
  const resp = await relayFetch(config, '/channels/telegram/register', {
    method: 'POST',
    body: JSON.stringify({ botToken, agentId: agentId || '' }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(body.error || `Telegram registration failed: ${resp.status}`);
  }
  return resp.json();
}

export async function listChannels(
  config: RelayConfig,
): Promise<ChannelConfig[]> {
  const resp = await relayFetch(config, '/channels');
  if (!resp.ok) {
    throw new Error(`List channels failed: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.channels;
}

export async function updateChannel(
  config: RelayConfig,
  channelId: string,
  updates: { metadata?: Record<string, unknown> },
): Promise<void> {
  const resp = await relayFetch(config, `/channels/${channelId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!resp.ok) {
    throw new Error(`Update channel failed: ${resp.status} ${resp.statusText}`);
  }
}

export async function removeChannel(
  config: RelayConfig,
  channelId: string,
): Promise<void> {
  const resp = await relayFetch(config, `/channels/${channelId}`, {
    method: 'DELETE',
  });
  if (!resp.ok) {
    throw new Error(`Remove channel failed: ${resp.status} ${resp.statusText}`);
  }
}
