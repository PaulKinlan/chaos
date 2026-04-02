/**
 * WASM Tools Index
 *
 * Public API for the WASM tool runtime. Exports functions to get,
 * install, and list WASM tools as Vercel AI SDK tools.
 */

import type { ToolSet } from 'ai';
import type { WasmToolManifest, WasmToolPackage } from './types.js';
import { builtinManifests } from './builtin.js';
import { installTool, installJsFallbackTool, listToolManifests, listTools } from './store.js';
import { wasmToolToAITool } from './tool-adapter.js';
import { hasJsFallback } from './builtin.js';

// Track whether built-in tools have been initialized
let builtinsInitialized = false;

/**
 * Ensure built-in tools are registered in the store.
 * Called lazily on first use.
 */
async function ensureBuiltins(): Promise<void> {
  if (builtinsInitialized) return;

  try {
    const existing = await listTools();
    const existingNames = new Set(existing.map((t) => t.name));

    for (const manifest of builtinManifests) {
      if (!existingNames.has(manifest.name)) {
        if (hasJsFallback(manifest.name)) {
          await installJsFallbackTool(manifest);
        }
        // Tools without JS fallback (md5sum, sha256sum) get installed
        // as JS fallback too since we have implementations
        else {
          await installJsFallbackTool(manifest);
        }
      }
    }
  } catch {
    // IndexedDB might not be available in all contexts (e.g. tests)
    // Built-in tools will still work via JS fallbacks
  }

  builtinsInitialized = true;
}

/**
 * Get all installed WASM tools as Vercel AI SDK tools.
 * Includes built-in tools with JS fallbacks.
 */
export async function getWasmTools(): Promise<ToolSet> {
  await ensureBuiltins();

  const tools: ToolSet = {};

  // Always include built-in tools (they have JS fallbacks)
  for (const manifest of builtinManifests) {
    tools[`wasm_${manifest.name.replace(/-/g, '_')}`] = wasmToolToAITool(manifest);
  }

  // Add any user-installed WASM tools from the store
  try {
    const stored = await listTools();
    for (const tool of stored) {
      const key = `wasm_${tool.name.replace(/-/g, '_')}`;
      // Don't overwrite built-in tools
      if (!(key in tools)) {
        tools[key] = wasmToolToAITool(tool.manifest);
      }
    }
  } catch {
    // Store not available; built-ins still work
  }

  return tools;
}

/**
 * Install a new WASM tool package.
 */
export async function installWasmTool(pkg: WasmToolPackage): Promise<void> {
  await installTool(pkg);
}

/**
 * List metadata for all installed WASM tools.
 */
export async function listWasmTools(): Promise<WasmToolManifest[]> {
  await ensureBuiltins();

  try {
    return await listToolManifests();
  } catch {
    // If store isn't available, return built-in manifests
    return [...builtinManifests];
  }
}

// Re-export types
export type { WasmToolManifest, WasmToolPackage, WasmExecutionResult } from './types.js';
