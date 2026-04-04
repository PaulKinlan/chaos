// Relay client unit tests
// Uses mock fetch and chrome.storage to test client methods

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

// Mock chrome.storage.local
const storageData: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string) => Promise.resolve({ [key]: storageData[key] || null })),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(storageData, data);
        return Promise.resolve();
      }),
    },
  },
});

// Mock crypto.subtle for keypair generation and signing
const mockKeyPair = {
  publicKey: { type: 'public' } as unknown as CryptoKey,
  privateKey: { type: 'private' } as unknown as CryptoKey,
};

const mockPublicJwk: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'test-x-coordinate',
  y: 'test-y-coordinate',
};

const mockPrivateJwk: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'test-x-coordinate',
  y: 'test-y-coordinate',
  d: 'test-private-key',
};

vi.stubGlobal('crypto', {
  subtle: {
    generateKey: vi.fn(() => Promise.resolve(mockKeyPair)),
    exportKey: vi.fn((_format: string, key: CryptoKey) => {
      if (key === mockKeyPair.publicKey) return Promise.resolve(mockPublicJwk);
      return Promise.resolve(mockPrivateJwk);
    }),
    importKey: vi.fn(() => Promise.resolve(mockKeyPair.privateKey)),
    sign: vi.fn(() => Promise.resolve(new ArrayBuffer(64))),
    digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
  },
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  }),
});

beforeEach(() => {
  mockFetch.mockReset();
  // Clear storage
  for (const key of Object.keys(storageData)) {
    delete storageData[key];
  }
});

describe('registerWithRelay', () => {
  it('generates keypair, sends public key, and stores server public key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: 'u1',
          apiKey: 'k1',
          serverPublicKey: { kty: 'EC', crv: 'P-256', x: 'srv-x', y: 'srv-y' },
        }),
    });

    const result = await registerWithRelay('http://localhost:8787');
    expect(result.userId).toBe('u1');
    expect(result.apiKey).toBe('k1');

    // Should have called fetch with public key in body
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"publicKey"'),
      }),
    );

    // Should have stored the keypair
    expect(storageData['chaos-relay-keypair']).toBeDefined();

    // Should have stored the server public key
    expect(storageData['chaos-relay-server-public-key']).toBeDefined();
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
  it('fetches messages with since parameter and signature headers', async () => {
    // Store a keypair so signing happens
    storageData['chaos-relay-keypair'] = {
      privateKey: mockPrivateJwk,
      publicKey: mockPublicJwk,
    };

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

    // Check that signature headers are present
    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['X-Timestamp']).toBeDefined();
    expect(headers['X-Nonce']).toBeDefined();
    expect(headers['X-Signature']).toBeDefined();
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
