/**
 * JSON-RPC 2.0 message layer for MCP protocol communication.
 *
 * Provides types and helpers for constructing and identifying
 * JSON-RPC requests, responses, and notifications.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

let nextId = 1;

/**
 * Create a JSON-RPC 2.0 request with an auto-incrementing ID.
 */
export function createRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    ...(params !== undefined && { params }),
  };
}

/**
 * Create a JSON-RPC 2.0 notification (no id, no response expected).
 */
export function createNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined && { params }),
  };
}

/**
 * Type guard: is this a JSON-RPC response (has id + result or error)?
 */
export function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && 'id' in obj && ('result' in obj || 'error' in obj);
}

/**
 * Type guard: is this a JSON-RPC notification (has method but no id)?
 */
export function isNotification(msg: unknown): msg is JsonRpcNotification {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && 'method' in obj && !('id' in obj);
}

/**
 * Reset the internal ID counter (for testing only).
 */
export function _resetIdCounter(): void {
  nextId = 1;
}
