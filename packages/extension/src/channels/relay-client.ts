// HTTP client for the CHAOS relay server
// Used by the extension to communicate with the relay

import type { ChannelResponse, ChannelConfig, RelayPollResponse } from './types.js';

export interface RelayConfig {
  serverUrl: string;
  apiKey: string;
}

async function relayFetch(
  config: RelayConfig,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${config.serverUrl.replace(/\/$/, '')}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...options.headers,
    },
  });
  return resp;
}

export async function registerWithRelay(
  serverUrl: string,
): Promise<{ userId: string; apiKey: string }> {
  const url = `${serverUrl.replace(/\/$/, '')}/auth/register`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Registration failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
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
