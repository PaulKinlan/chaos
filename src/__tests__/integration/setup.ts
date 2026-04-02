/**
 * Shared test setup for integration tests.
 *
 * Provides:
 * - In-memory OPFS mock (same pattern as unit tests but exported for reuse)
 * - Chrome API mocks (storage.sync, storage.local, bookmarks, tabs, etc.)
 * - Helper utilities for creating agents and resetting state
 */

import { vi, beforeEach } from 'vitest';

// ── In-memory OPFS mock ──

class MockFileHandle {
  name: string;
  private content: string;

  constructor(name: string, content = '') {
    this.name = name;
    this.content = content;
  }

  async getFile() {
    return { text: async () => this.content };
  }

  async createWritable() {
    const self = this;
    let buffer = '';
    return {
      write(data: string) { buffer += data; },
      close() { self.content = buffer; },
    };
  }
}

class MockDirectoryHandle {
  name: string;
  kind = 'directory' as const;
  private files = new Map<string, MockFileHandle>();
  private dirs = new Map<string, MockDirectoryHandle>();

  constructor(name: string) {
    this.name = name;
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MockFileHandle> {
    if (this.files.has(name)) return this.files.get(name)!;
    if (options?.create) {
      const handle = new MockFileHandle(name);
      this.files.set(name, handle);
      return handle;
    }
    throw new DOMException('File not found', 'NotFoundError');
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MockDirectoryHandle> {
    if (this.dirs.has(name)) return this.dirs.get(name)!;
    if (options?.create) {
      const handle = new MockDirectoryHandle(name);
      this.dirs.set(name, handle);
      return handle;
    }
    throw new DOMException('Directory not found', 'NotFoundError');
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }) {
    if (!this.files.has(name) && !this.dirs.has(name)) {
      throw new DOMException('Not found', 'NotFoundError');
    }
    this.files.delete(name);
    this.dirs.delete(name);
  }

  entries(): AsyncIterable<[string, MockFileHandle | MockDirectoryHandle]> {
    const all = new Map<string, MockFileHandle | MockDirectoryHandle>();
    for (const [k, v] of this.files) all.set(k, v);
    for (const [k, v] of this.dirs) all.set(k, v);
    const iter = all.entries();
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() { return iter.next(); },
        };
      },
    };
  }

  /** Clear all contents (for test reset) */
  clear() {
    this.files.clear();
    this.dirs.clear();
  }
}

// ── Chrome storage mock ──

function createChromeStorageMock() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const result: Record<string, unknown> = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        if (store.has(key)) result[key] = store.get(key);
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) store.delete(key);
    }),
    clear: vi.fn(async () => store.clear()),
    _store: store,
  };
}

// ── Chrome bookmarks mock ──

let bookmarkIdCounter = 1;
const bookmarkStore = new Map<string, { id: string; title: string; url?: string; parentId?: string; children?: string[] }>();

function createBookmarksMock() {
  return {
    create: vi.fn(async (opts: { title: string; url?: string; parentId?: string }) => {
      const id = String(bookmarkIdCounter++);
      bookmarkStore.set(id, { id, ...opts });
      return { id, title: opts.title, url: opts.url };
    }),
    removeTree: vi.fn(async (id: string) => {
      bookmarkStore.delete(id);
    }),
    getChildren: vi.fn(async (id: string) => {
      return Array.from(bookmarkStore.values()).filter(b => b.parentId === id);
    }),
    search: vi.fn(async () => []),
  };
}

// ── Setup and export ──

let mockRoot: MockDirectoryHandle;

export function getMockRoot(): MockDirectoryHandle {
  return mockRoot;
}

/**
 * Install all mocks. Call this once at module scope (vi.mock calls)
 * or use setupIntegrationTest() for per-test reset.
 */
export function setupIntegrationMocks() {
  mockRoot = new MockDirectoryHandle('root');

  // navigator.storage
  vi.stubGlobal('navigator', {
    storage: { getDirectory: vi.fn().mockResolvedValue(mockRoot) },
  });

  // crypto.randomUUID
  let uuidCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  });

  // Chrome API
  const syncStorage = createChromeStorageMock();
  const localStorage = createChromeStorageMock();

  vi.stubGlobal('chrome', {
    storage: {
      sync: syncStorage,
      local: localStorage,
    },
    bookmarks: createBookmarksMock(),
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      query: vi.fn(async () => []),
      remove: vi.fn(async () => {}),
      group: vi.fn(async () => 1),
      sendMessage: vi.fn(async () => ({})),
    },
    tabGroups: {
      update: vi.fn(async () => ({})),
    },
    history: {
      search: vi.fn(async () => []),
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(async () => true),
      getAll: vi.fn(async () => []),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(),
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      onInstalled: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn(async () => {}),
      onClicked: { addListener: vi.fn() },
    },
  });

  return { syncStorage, localStorage, mockRoot };
}

/**
 * Reset all state between tests. Call in beforeEach.
 */
export function resetIntegrationState() {
  mockRoot.clear();
  bookmarkIdCounter = 1;
  bookmarkStore.clear();

  // Reset chrome storage stores
  (chrome.storage.sync as any)._store.clear();
  (chrome.storage.local as any)._store.clear();

  vi.clearAllMocks();

  // Re-stub navigator so OPFS gets a fresh root
  mockRoot = new MockDirectoryHandle('root');
  vi.stubGlobal('navigator', {
    storage: { getDirectory: vi.fn().mockResolvedValue(mockRoot) },
  });

  // Reset UUID counter
  let uuidCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  });
}
