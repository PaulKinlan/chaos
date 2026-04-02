/**
 * Built-in WASM Tools
 *
 * Defines metadata and JS fallback implementations for tools that
 * come pre-installed. These tools work immediately via pure JS;
 * WASM binaries can be loaded later for higher performance.
 */

import type { WasmToolManifest, WasmExecutionResult } from './types.js';

// ── Built-in tool manifests ──

export const builtinManifests: WasmToolManifest[] = [
  {
    name: 'base64',
    description: 'Encode or decode base64. Input format: "encode:<text>" or "decode:<base64string>".',
    keywords: ['base64', 'encode', 'decode', 'binary', 'text', 'convert'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'md5sum',
    description: 'Compute the MD5 hash of the input text.',
    keywords: ['md5', 'hash', 'checksum', 'digest', 'crypto'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'sha256sum',
    description: 'Compute the SHA-256 hash of the input text.',
    keywords: ['sha256', 'hash', 'checksum', 'digest', 'crypto', 'sha'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'wc',
    description: 'Count lines, words, and characters in the input text.',
    keywords: ['count', 'words', 'lines', 'characters', 'wc', 'length', 'stats'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'sort',
    description: 'Sort lines of text alphabetically.',
    keywords: ['sort', 'order', 'alphabetical', 'arrange', 'lines'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'uniq',
    description: 'Remove consecutive duplicate lines from text.',
    keywords: ['unique', 'deduplicate', 'uniq', 'distinct', 'lines', 'duplicates'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
  {
    name: 'json-format',
    description: 'Pretty-print JSON with 2-space indentation. Input must be valid JSON.',
    keywords: ['json', 'format', 'pretty', 'print', 'indent', 'beautify'],
    inputType: 'text',
    outputType: 'text',
    timeoutMs: 5000,
  },
];

// ── JS fallback implementations ──

/**
 * Map of tool name to a JS function that implements the tool.
 * These run in the main thread (or wherever called) without WASM.
 */
export const jsFallbacks: Record<string, (input: string) => Promise<WasmExecutionResult>> = {
  async base64(input: string): Promise<WasmExecutionResult> {
    try {
      if (input.startsWith('decode:')) {
        const encoded = input.slice(7);
        const decoded = atob(encoded);
        return { stdout: decoded, stderr: '', exitCode: 0 };
      }
      // Default to encode; strip optional "encode:" prefix
      const text = input.startsWith('encode:') ? input.slice(7) : input;
      const encoded = btoa(text);
      return { stdout: encoded, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: '',
        stderr: `base64 error: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      };
    }
  },

  async md5sum(input: string): Promise<WasmExecutionResult> {
    // Simple MD5 implementation (not for security use)
    try {
      const hash = md5(input);
      return { stdout: hash, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: '',
        stderr: `md5 error: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      };
    }
  },

  async sha256sum(input: string): Promise<WasmExecutionResult> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(input);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return { stdout: hashHex, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: '',
        stderr: `sha256 error: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      };
    }
  },

  async wc(input: string): Promise<WasmExecutionResult> {
    const lines = input === '' ? 0 : input.split('\n').length;
    const words = input.trim() === '' ? 0 : input.trim().split(/\s+/).length;
    const chars = input.length;
    return {
      stdout: `${lines} ${words} ${chars}`,
      stderr: '',
      exitCode: 0,
    };
  },

  async sort(input: string): Promise<WasmExecutionResult> {
    const lines = input.split('\n');
    lines.sort();
    return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
  },

  async uniq(input: string): Promise<WasmExecutionResult> {
    const lines = input.split('\n');
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 || lines[i] !== lines[i - 1]) {
        result.push(lines[i]!);
      }
    }
    return { stdout: result.join('\n'), stderr: '', exitCode: 0 };
  },

  async 'json-format'(input: string): Promise<WasmExecutionResult> {
    try {
      const parsed = JSON.parse(input);
      const formatted = JSON.stringify(parsed, null, 2);
      return { stdout: formatted, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: '',
        stderr: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
      };
    }
  },
};

// ── Minimal MD5 implementation ──

function md5(input: string): string {
  // Convert string to array of character codes
  const msg = new TextEncoder().encode(input);

  // Pre-processing: pad message
  const msgLen = msg.length;
  const bitLen = msgLen * 8;
  // Pad to 56 mod 64 bytes
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64;
  const padded = new Uint8Array(msgLen + 1 + padLen + 8);
  padded.set(msg);
  padded[msgLen] = 0x80;
  // Append bit length as 64-bit little-endian
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen & 0xffffffff, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  // MD5 constants
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Process each 64-byte block
  for (let offset = 0; offset < padded.length; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      F = (F + A + K[i]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]!) | (F >>> (32 - S[i]!)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Format as hex
  function toHex(n: number): string {
    const bytes = new Uint8Array(4);
    bytes[0] = n & 0xff;
    bytes[1] = (n >>> 8) & 0xff;
    bytes[2] = (n >>> 16) & 0xff;
    bytes[3] = (n >>> 24) & 0xff;
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

/**
 * Execute a built-in tool using its JS fallback.
 * Returns undefined if no fallback exists for the given tool name.
 */
export async function executeJsFallback(
  name: string,
  input: string,
): Promise<WasmExecutionResult | undefined> {
  const fallback = jsFallbacks[name];
  if (!fallback) return undefined;
  return fallback(input);
}

/**
 * Check if a tool has a JS fallback implementation.
 */
export function hasJsFallback(name: string): boolean {
  return name in jsFallbacks;
}
