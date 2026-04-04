/**
 * WASM Tool Runtime - Type Definitions
 *
 * Interfaces for the sandboxed WASM tool execution system.
 * Ported from co-do patterns, simplified for CHAOS.
 */

export interface WasmToolManifest {
  name: string;
  description: string;
  keywords: string[];
  inputType: 'text' | 'binary' | 'none';
  outputType: 'text' | 'binary';
  fileAccess?: 'read' | 'write' | 'readwrite';
  memoryLimitMB?: number; // default 32
  timeoutMs?: number; // default 30000
}

export interface WasmToolPackage {
  manifest: WasmToolManifest;
  wasmBinary: ArrayBuffer;
}

export interface WasmExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputFiles?: { name: string; content: Uint8Array }[];
}

/**
 * Stored WASM tool in IndexedDB.
 */
export interface StoredWasmTool {
  name: string;
  manifest: WasmToolManifest;
  wasmBinary: ArrayBuffer;
  /** If true, tool has a JS fallback and doesn't need a real WASM binary. */
  jsFallback: boolean;
  installedAt: number;
}

/**
 * Message sent from main thread to WASM worker.
 */
export interface WasmWorkerRequest {
  id: string;
  wasmBinary: ArrayBuffer;
  input: string;
  args: string[];
}

/**
 * Message sent from WASM worker back to main thread.
 */
export interface WasmWorkerResponse {
  id: string;
  result?: WasmExecutionResult;
  error?: string;
}
