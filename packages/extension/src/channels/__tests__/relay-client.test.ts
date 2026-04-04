// Relay client unit tests
// Uses mock fetch to test client methods without a running server

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerWithRelay,
  pollMessages,
  sendReply,
  registerChannel,
  listChannels,
  removeChannel,
  type RelayConfig,
} from '../relay-client.js';

const mockConfig: RelayConfig = {
  serverUrl: 'http://localhost:8787',
  apiKey: 'test-api-key',
};

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('registerWithRelay', () => {
  it('calls POST /auth/register and returns credentials', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ userId: 'u1', apiKey: 'k1' }),
    });

    const result = await registerWithRelay('http://localhost:8787');
    expect(result.userId).toBe('u1');
    expect(result.apiKey).toBe('k1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(registerWithRelay('http://localhost:8787')).rejects.toThrow(
      'Registration failed',
    );
  });
});

describe('pollMessages', () => {
  it('fetches messages with since parameter', async () => {
    const since = '2025-01-01T00:00:00Z';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ id: 'm1', content: 'hello' }],
          since: '2025-01-01T00:01:00Z',
        }),
    });

    const result = await pollMessages(mockConfig, since);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe('m1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/messages?since=${encodeURIComponent(since)}`),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      }),
    );
  });

  it('fetches messages without since', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ messages: [], since: '2025-01-01T00:00:00Z' }),
    });

    const result = await pollMessages(mockConfig, '');
    expect(result.messages).toHaveLength(0);
  });
});

describe('sendReply', () => {
  it('sends a reply via POST /reply', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await sendReply(mockConfig, {
      channelType: 'webhook',
      channelId: 'ch1',
      content: 'Reply content',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/reply',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Reply content'),
      }),
    );
  });
});

describe('registerChannel', () => {
  it('registers a webhook channel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          channel: { id: 'ch1', type: 'webhook' },
          webhookUrl: 'http://localhost:8787/webhook/ch1?token=secret',
        }),
    });

    const result = await registerChannel(mockConfig, { type: 'webhook' });
    expect(result.channel.id).toBe('ch1');
    expect(result.webhookUrl).toContain('/webhook/ch1');
  });
});

describe('listChannels', () => {
  it('lists channels', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ channels: [{ id: 'ch1' }, { id: 'ch2' }] }),
    });

    const channels = await listChannels(mockConfig);
    expect(channels).toHaveLength(2);
  });
});

describe('removeChannel', () => {
  it('removes a channel', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await removeChannel(mockConfig, 'ch1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/channels/ch1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(removeChannel(mockConfig, 'nonexistent')).rejects.toThrow(
      'Remove channel failed',
    );
  });
});
