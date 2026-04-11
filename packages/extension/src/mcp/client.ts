/**
 * MCP Client with Streamable HTTP transport.
 *
 * Implements the Model Context Protocol client using fetch()-based
 * Streamable HTTP transport, suitable for Chrome extension service workers.
 *
 * Protocol spec: https://modelcontextprotocol.io/specification/2025-03-26
 */

import { createRequest, createNotification, isResponse, type JsonRpcResponse } from './jsonrpc.js';

// ── Configuration ──────────────────────────────────────────────────

export interface McpServerConfig {
  url: string;
  name: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

// ── Connection state ───────────────────────────────────────────────

export type McpConnectionState = 'disconnected' | 'connecting' | 'ready' | 'error';

// ── MCP protocol types ─────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptTemplate {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpResourceContents {
  contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
}

export interface McpPromptResult {
  messages: Array<{ role: string; content: unknown }>;
}

// ── Server capabilities (returned from initialize) ─────────────────

export interface McpServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  logging?: Record<string, unknown>;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpServerCapabilities;
  serverInfo: { name: string; version: string };
}

// ── Client ─────────────────────────────────────────────────────────

const CLIENT_INFO = {
  name: 'chaos-extension',
  version: '0.1.0',
};

const PROTOCOL_VERSION = '2025-03-26';

export class McpClient {
  readonly config: McpServerConfig;
  private _state: McpConnectionState = 'disconnected';
  private sessionId?: string;
  private nextId = 1;
  private serverCapabilities?: McpServerCapabilities;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  get state(): McpConnectionState {
    return this._state;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Connect to the MCP server: send `initialize`, then `notifications/initialized`.
   */
  async connect(): Promise<void> {
    if (this._state === 'ready') return;

    this._state = 'connecting';
    console.log(`[MCP] Connecting to ${this.config.name} at ${this.config.url}`);

    try {
      const result = await this.sendRequest('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }) as McpInitializeResult;

      this.serverCapabilities = result.capabilities;
      console.log(`[MCP] Connected to ${result.serverInfo.name} v${result.serverInfo.version}`);
      console.log(`[MCP] Server capabilities:`, result.capabilities);

      // Send initialized notification
      await this.sendNotification('notifications/initialized');

      this._state = 'ready';
    } catch (err) {
      this._state = 'error';
      console.error(`[MCP] Connection failed for ${this.config.name}:`, err);
      throw err;
    }
  }

  /**
   * Disconnect from the MCP server by sending an HTTP DELETE.
   */
  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') return;

    console.log(`[MCP] Disconnecting from ${this.config.name}`);

    if (this.sessionId) {
      try {
        const headers: Record<string, string> = {
          ...this.config.headers,
        };
        headers['Mcp-Session-Id'] = this.sessionId;

        if (this.config.apiKey) {
          headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        await fetch(this.config.url, {
          method: 'DELETE',
          headers,
        });
      } catch (err) {
        console.warn(`[MCP] Error during disconnect for ${this.config.name}:`, err);
      }
    }

    this.sessionId = undefined;
    this.serverCapabilities = undefined;
    this._state = 'disconnected';
  }

  // ── Tools ──────────────────────────────────────────────────────

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<McpTool[]> {
    this.assertReady();
    const result = await this.sendRequest('tools/list') as { tools: McpTool[] };
    console.log(`[MCP] ${this.config.name} has ${result.tools.length} tools`);
    return result.tools;
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.assertReady();
    console.log(`[MCP] Calling tool ${name} on ${this.config.name}`);
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  // ── Resources ──────────────────────────────────────────────────

  /**
   * List available resources from the MCP server.
   */
  async listResources(): Promise<McpResource[]> {
    this.assertReady();
    const result = await this.sendRequest('resources/list') as { resources: McpResource[] };
    console.log(`[MCP] ${this.config.name} has ${result.resources.length} resources`);
    return result.resources;
  }

  /**
   * Read a resource by URI from the MCP server.
   */
  async readResource(uri: string): Promise<McpResourceContents> {
    this.assertReady();
    console.log(`[MCP] Reading resource ${uri} from ${this.config.name}`);
    const result = await this.sendRequest('resources/read', { uri }) as McpResourceContents;
    return result;
  }

  // ── Prompts ────────────────────────────────────────────────────

  /**
   * List available prompt templates from the MCP server.
   */
  async listPrompts(): Promise<McpPromptTemplate[]> {
    this.assertReady();
    const result = await this.sendRequest('prompts/list') as { prompts: McpPromptTemplate[] };
    console.log(`[MCP] ${this.config.name} has ${result.prompts.length} prompts`);
    return result.prompts;
  }

  /**
   * Get a rendered prompt template from the MCP server.
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptResult> {
    this.assertReady();
    console.log(`[MCP] Getting prompt ${name} from ${this.config.name}`);
    const result = await this.sendRequest('prompts/get', {
      name,
      ...(args !== undefined && { arguments: args }),
    }) as McpPromptResult;
    return result;
  }

  // ── Transport ──────────────────────────────────────────────────

  /**
   * Send a JSON-RPC request via Streamable HTTP POST and return the result.
   */
  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request = createRequest(method, params);
    request.id = this.nextId++;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    console.log(`[MCP] -> ${method}`, params ?? '');

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    // Capture session ID from response
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (newSessionId) {
      this.sessionId = newSessionId;
      console.log(`[MCP] Session ID: ${newSessionId}`);
    }

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type') ?? '';

    // Handle JSON response (most common)
    if (contentType.includes('application/json')) {
      const json = await response.json();
      if (isResponse(json) && json.error) {
        throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
      }
      return (json as JsonRpcResponse).result;
    }

    // Handle SSE response — extract the JSON-RPC response from the event stream
    if (contentType.includes('text/event-stream')) {
      return this.readSseResponse(response, request.id);
    }

    throw new Error(`Unexpected Content-Type from MCP server: ${contentType}`);
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const notification = createNotification(method, params);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    console.log(`[MCP] -> notification: ${method}`);

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(notification),
    });

    // Notifications may return 202 Accepted or 200 with no body
    if (!response.ok && response.status !== 202) {
      console.warn(`[MCP] Notification ${method} got status ${response.status}`);
    }
  }

  /**
   * Parse a text/event-stream response to extract the JSON-RPC response
   * matching our request ID.
   */
  private async readSseResponse(response: Response, requestId: number | string): Promise<unknown> {
    const text = await response.text();
    const lines = text.split('\n');
    let data = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (isResponse(parsed) && parsed.id === requestId) {
            if (parsed.error) {
              throw new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`);
            }
            return parsed.result;
          }
        } catch (e) {
          // Not valid JSON or not our response; continue scanning
          if (e instanceof Error && e.message.startsWith('MCP error')) {
            throw e;
          }
        }
      }
    }

    throw new Error('No matching JSON-RPC response found in SSE stream');
  }

  /**
   * Throw if the client is not in the ready state.
   */
  private assertReady(): void {
    if (this._state !== 'ready') {
      throw new Error(`MCP client not ready (state: ${this._state}). Call connect() first.`);
    }
  }
}
