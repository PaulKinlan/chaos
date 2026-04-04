/**
 * WASM Tool Store
 *
 * IndexedDB-backed storage for WASM tool packages.
 * Uses a separate 'wasm-tools' object store in the chaos-db.
 */

import type { WasmToolManifest, WasmToolPackage, StoredWasmTool } from './types.js';

// ── IndexedDB helpers (standalone, avoids circular dep with idb.ts) ──

const DB_NAME = 'chaos-db';
const DB_VERSION = 2; // bumped from 1 to add wasm-tools store
const STORE_NAME = 'wasm-tools';

function openWasmDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create existing stores if they don't exist (first install)
      if (!db.objectStoreNames.contains('conversations')) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-agent', 'agentId');
      }
      if (!db.objectStoreNames.contains('tool-configs')) {
        db.createObjectStore('tool-configs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('page-cache')) {
        const pageStore = db.createObjectStore('page-cache', { keyPath: 'url' });
        pageStore.createIndex('by-agent', 'agentId');
      }
      if (!db.objectStoreNames.contains('embeddings')) {
        const embStore = db.createObjectStore('embeddings', { keyPath: 'id' });
        embStore.createIndex('by-source', 'sourceId');
      }

      // Add wasm-tools store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openWasmDB();
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = fn(store);
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    } catch (err) {
      reject(err);
    }
  });
}

// ── Public API ──

/**
 * Install a WASM tool package into IndexedDB.
 */
export async function installTool(pkg: WasmToolPackage): Promise<void> {
  const stored: StoredWasmTool = {
    name: pkg.manifest.name,
    manifest: pkg.manifest,
    wasmBinary: pkg.wasmBinary,
    jsFallback: false,
    installedAt: Date.now(),
  };
  await withStore('readwrite', (store) => store.put(stored));
}

/**
 * Install a JS-fallback tool (no real WASM binary needed).
 */
export async function installJsFallbackTool(manifest: WasmToolManifest): Promise<void> {
  const stored: StoredWasmTool = {
    name: manifest.name,
    manifest,
    wasmBinary: new ArrayBuffer(0),
    jsFallback: true,
    installedAt: Date.now(),
  };
  await withStore('readwrite', (store) => store.put(stored));
}

/**
 * Uninstall a WASM tool by name.
 */
export async function uninstallTool(name: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(name));
}

/**
 * Get a stored WASM tool by name.
 */
export async function getTool(name: string): Promise<StoredWasmTool | undefined> {
  return withStore('readonly', (store) => store.get(name));
}

/**
 * List all installed WASM tools.
 */
export async function listTools(): Promise<StoredWasmTool[]> {
  return withStore('readonly', (store) => store.getAll());
}

/**
 * List just the manifests of all installed tools.
 */
export async function listToolManifests(): Promise<WasmToolManifest[]> {
  const tools = await listTools();
  return tools.map((t) => t.manifest);
}
