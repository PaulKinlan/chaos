/**
 * WASM Tool Adapter
 *
 * Converts WASM tool manifests into Vercel AI SDK tool() format
 * so agents can use them seamlessly alongside other tools.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { WasmToolManifest } from './types.js';
import { executeWasm } from './runtime.js';
import { executeJsFallback, hasJsFallback } from './builtin.js';
import { getTool } from './store.js';

/**
 * Convert a WasmToolManifest into a Vercel AI SDK tool.
 */
export function wasmToolToAITool(manifest: WasmToolManifest) {
  return tool({
    description: manifest.description,
    parameters: z.object({
      input: z.string().describe('Input text for the tool'),
    }),
    execute: async ({ input }) => {
      // Try JS fallback first (faster, no worker overhead)
      if (hasJsFallback(manifest.name)) {
        const result = await executeJsFallback(manifest.name, input);
        if (result) {
          if (result.exitCode !== 0) {
            return `Error (exit ${result.exitCode}): ${result.stderr}`;
          }
          return result.stdout;
        }
      }

      // Fall back to WASM execution
      const stored = await getTool(manifest.name);
      if (!stored || stored.wasmBinary.byteLength === 0) {
        return `Error: WASM binary not available for tool "${manifest.name}". No JS fallback found.`;
      }

      try {
        const result = await executeWasm(stored.wasmBinary, input, {
          timeoutMs: manifest.timeoutMs,
          memoryLimitMB: manifest.memoryLimitMB,
        });

        if (result.exitCode !== 0) {
          return `Error (exit ${result.exitCode}): ${result.stderr}`;
        }
        return result.stdout;
      } catch (err) {
        return `Execution error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
