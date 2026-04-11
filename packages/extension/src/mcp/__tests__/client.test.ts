/**
 * Tests for the MCP client module: JSON-RPC message layer and McpClient.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRequest,
  createNotification,
  isResponse,
  isNotification,
  _resetIdCounter,
} from '../jsonrpc.js';
import { McpClient, type McpServerConfig } from '../client.js';

// ── JSON-RPC message layer tests ─────────────────────────────────

describe('jsonrpc', () => {
  beforeEach(() => {
    _resetIdCounter();
  });

  describe('createRequest', () => {
    it('creates a valid JSON-RPC 2.0 request', () => {
      const req = createRequest('tools/list');
      expect(req).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
    });

    it('includes params when provided', () => {
      const req = createRequest('tools/call', { name: 'search', arguments: { q: 'test' } });
      expect(req.params).toEqual({ name: 'search', arguments: { q: 'test' } });
    });

    it('omits params when undefined', () => {
      const req = createRequest('tools/list');
      expect('params' in req).toBe(false);
    });

    it('auto-increments the ID', () => {
      const r1 = createRequest('a');
      const r2 = createRequest('b');
      const r3 = createRequest('c');
      expect(r1.id).toBe(1);
      expect(r2.id).toBe(2);
      expect(r3.id).toBe(3);
    });
  });

  describe('createNotification', () => {
    it('creates a valid JSON-RPC 2.0 notification (no id)', () => {
      const notif = createNotification('notifications/initialized');
      expect(notif).toEqual({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      expect('id' in notif).toBe(false);
    });

    it('includes params when provided', () => {
      const notif = createNotification('notifications/progress', { token: 'abc', progress: 50 });
      expect(notif.params).toEqual({ token: 'abc', progress: 50 });
    });

    it('omits params when undefined', () => {
      const notif = createNotification('notifications/initialized');
      expect('params' in notif).toBe(false);
    });
  });

  describe('isResponse', () => {
    it('returns true for a success response', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } })).toBe(true);
    });

    it('returns true for an error response', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'fail' } })).toBe(true);
    });

    it('returns false for a request (has method)', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
    });

    it('returns false for a notification', () => {
      expect(isResponse({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isResponse(null)).toBe(false);
    });

    it('returns false for non-objects', () => {
      expect(isResponse('string')).toBe(false);
      expect(isResponse(42)).toBe(false);
    });
  });

  describe('isNotification', () => {
    it('returns true for a notification', () => {
      expect(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true);
    });

    it('returns false for a request (has id)', () => {
      expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
    });

    it('returns false for a response', () => {
      expect(isNotification({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isNotification(null)).toBe(false);
    });
  });
});

// ── McpClient tests ──────────────────────────────────────────────

describe('McpClient', () => {
  const mockConfig: McpServerConfig = {
    url: 'https://mcp.example.com/v1',
    name: 'test-server',
    apiKey: 'test-key-123',
    headers: { 'X-Custom': 'value' },
  };

  let client: McpClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new McpClient(mockConfig);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  }

  function initializeResponse(sessionId?: string): Response {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    }), { status: 200, headers });
  }

  /** Set up fetch to handle the initialize + initialized handshake, then ready for more calls */
  function mockInitialize(sessionId = 'session-abc') {
    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // initialize request
        return Promise.resolve(initializeResponse(sessionId));
      }
      if (callCount === 2) {
        // notifications/initialized — 202 Accepted
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      // Unexpected
      return Promise.resolve(new Response('unexpected', { status: 500 }));
    });
  }

  async function connectClient(sessionId = 'session-abc') {
    mockInitialize(sessionId);
    await client.connect();
  }

  // ── Constructor & state ────────────────────────────────────────

  describe('constructor', () => {
    it('starts in disconnected state', () => {
      expect(client.state).toBe('disconnected');
    });

    it('stores config', () => {
      expect(client.config).toBe(mockConfig);
    });
  });

  // ── connect() ──────────────────────────────────────────────────

  describe('connect', () => {
    it('sends initialize request and transitions to ready', async () => {
      mockInitialize();
      await client.connect();

      expect(client.state).toBe('ready');
      expect(fetchSpy).toHaveBeenCalledTimes(2); // initialize + initialized notification
    });

    it('sends correct initialize params', async () => {
      mockInitialize();
      await client.connect();

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(mockConfig.url);
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.method).toBe('initialize');
      expect(body.params.protocolVersion).toBe('2025-03-26');
      expect(body.params.clientInfo.name).toBe('chaos-extension');
    });

    it('includes Authorization header when apiKey is set', async () => {
      mockInitialize();
      await client.connect();

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-key-123');
    });

    it('includes custom headers', async () => {
      mockInitialize();
      await client.connect();

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers['X-Custom']).toBe('value');
    });

    it('stores session ID from response', async () => {
      mockInitialize('my-session-42');
      await client.connect();

      // The third call (after connect) should include the session ID
      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { tools: [] },
      }));

      await client.listTools();
      const [, options] = fetchSpy.mock.calls[2]; // third call
      expect(options.headers['Mcp-Session-Id']).toBe('my-session-42');
    });

    it('transitions to error state on failure', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await expect(client.connect()).rejects.toThrow('Network error');
      expect(client.state).toBe('error');
    });

    it('transitions to error on non-200 response', async () => {
      fetchSpy.mockResolvedValue(new Response('Not found', { status: 404, statusText: 'Not Found' }));

      await expect(client.connect()).rejects.toThrow('MCP request failed: 404 Not Found');
      expect(client.state).toBe('error');
    });

    it('is a no-op if already ready', async () => {
      mockInitialize();
      await client.connect();
      fetchSpy.mockClear();

      await client.connect();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── disconnect() ───────────────────────────────────────────────

  describe('disconnect', () => {
    it('sends DELETE with session ID', async () => {
      await connectClient('session-xyz');
      fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));

      await client.disconnect();

      const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      expect(lastCall[1].method).toBe('DELETE');
      expect(lastCall[1].headers['Mcp-Session-Id']).toBe('session-xyz');
      expect(client.state).toBe('disconnected');
    });

    it('is a no-op if already disconnected', async () => {
      fetchSpy.mockClear();
      await client.disconnect();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('handles DELETE failure gracefully', async () => {
      await connectClient();
      fetchSpy.mockRejectedValue(new Error('network down'));

      await client.disconnect(); // Should not throw
      expect(client.state).toBe('disconnected');
    });
  });

  // ── listTools() ────────────────────────────────────────────────

  describe('listTools', () => {
    it('returns tools from the server', async () => {
      await connectClient();

      const tools = [
        { name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
        { name: 'calculate', description: 'Do math', inputSchema: { type: 'object' } },
      ];

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { tools },
      }));

      const result = await client.listTools();
      expect(result).toEqual(tools);
    });

    it('sends tools/list method', async () => {
      await connectClient();
      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { tools: [] },
      }));

      await client.listTools();
      const [, options] = fetchSpy.mock.calls[2];
      const body = JSON.parse(options.body);
      expect(body.method).toBe('tools/list');
    });

    it('throws if not connected', async () => {
      await expect(client.listTools()).rejects.toThrow('MCP client not ready');
    });
  });

  // ── callTool() ─────────────────────────────────────────────────

  describe('callTool', () => {
    it('sends tool name and arguments', async () => {
      await connectClient();

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'result' }] },
      }));

      const result = await client.callTool('search', { query: 'hello' });
      expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] });

      const [, options] = fetchSpy.mock.calls[2];
      const body = JSON.parse(options.body);
      expect(body.method).toBe('tools/call');
      expect(body.params).toEqual({ name: 'search', arguments: { query: 'hello' } });
    });

    it('throws if not connected', async () => {
      await expect(client.callTool('search', {})).rejects.toThrow('MCP client not ready');
    });
  });

  // ── listResources() ────────────────────────────────────────────

  describe('listResources', () => {
    it('returns resources from the server', async () => {
      await connectClient();

      const resources = [
        { uri: 'file:///readme.md', name: 'README', mimeType: 'text/markdown' },
      ];

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { resources },
      }));

      const result = await client.listResources();
      expect(result).toEqual(resources);
    });
  });

  // ── readResource() ─────────────────────────────────────────────

  describe('readResource', () => {
    it('reads a resource by URI', async () => {
      await connectClient();

      const contents = {
        contents: [{ uri: 'file:///readme.md', text: '# Hello', mimeType: 'text/markdown' }],
      };

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: contents,
      }));

      const result = await client.readResource('file:///readme.md');
      expect(result).toEqual(contents);

      const [, options] = fetchSpy.mock.calls[2];
      const body = JSON.parse(options.body);
      expect(body.params.uri).toBe('file:///readme.md');
    });
  });

  // ── listPrompts() ──────────────────────────────────────────────

  describe('listPrompts', () => {
    it('returns prompt templates', async () => {
      await connectClient();

      const prompts = [
        { name: 'summarize', description: 'Summarize text', arguments: [{ name: 'text', required: true }] },
      ];

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { prompts },
      }));

      const result = await client.listPrompts();
      expect(result).toEqual(prompts);
    });
  });

  // ── getPrompt() ────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('gets a rendered prompt', async () => {
      await connectClient();

      const promptResult = {
        messages: [{ role: 'user', content: 'Summarize: hello world' }],
      };

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: promptResult,
      }));

      const result = await client.getPrompt('summarize', { text: 'hello world' });
      expect(result).toEqual(promptResult);

      const [, options] = fetchSpy.mock.calls[2];
      const body = JSON.parse(options.body);
      expect(body.method).toBe('prompts/get');
      expect(body.params).toEqual({ name: 'summarize', arguments: { text: 'hello world' } });
    });

    it('works without arguments', async () => {
      await connectClient();

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0', id: 3, result: { messages: [] },
      }));

      await client.getPrompt('empty-prompt');

      const [, options] = fetchSpy.mock.calls[2];
      const body = JSON.parse(options.body);
      expect(body.params).toEqual({ name: 'empty-prompt' });
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on JSON-RPC error response', async () => {
      await connectClient();

      fetchSpy.mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32601, message: 'Method not found' },
      }));

      await expect(client.listTools()).rejects.toThrow('MCP error -32601: Method not found');
    });

    it('throws on HTTP error', async () => {
      await connectClient();

      fetchSpy.mockResolvedValueOnce(new Response('Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }));

      await expect(client.listTools()).rejects.toThrow('MCP request failed: 500 Internal Server Error');
    });

    it('throws on unexpected content type', async () => {
      await connectClient();

      fetchSpy.mockResolvedValueOnce(new Response('<html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));

      await expect(client.listTools()).rejects.toThrow('Unexpected Content-Type');
    });
  });

  // ── SSE response handling ──────────────────────────────────────

  describe('SSE response handling', () => {
    it('extracts JSON-RPC response from SSE stream', async () => {
      await connectClient();

      const sseBody = [
        'event: message',
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'test', description: 'A test tool', inputSchema: {} }] } })}`,
        '',
      ].join('\n');

      fetchSpy.mockResolvedValueOnce(new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));

      const result = await client.listTools();
      expect(result).toEqual([{ name: 'test', description: 'A test tool', inputSchema: {} }]);
    });
  });

  // ── No apiKey scenario ─────────────────────────────────────────

  describe('without apiKey', () => {
    it('does not include Authorization header', async () => {
      const noAuthClient = new McpClient({
        url: 'https://mcp.example.com/v1',
        name: 'no-auth-server',
      });

      let callCount = 0;
      fetchSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(initializeResponse());
        if (callCount === 2) return Promise.resolve(new Response(null, { status: 202 }));
        return Promise.resolve(new Response('unexpected', { status: 500 }));
      });

      await noAuthClient.connect();

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });
  });
});
