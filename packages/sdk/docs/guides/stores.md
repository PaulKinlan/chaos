# Stores Guide

The SDK uses six store interfaces to abstract all data persistence. You can swap in any backend -- IndexedDB, SQLite, filesystem, cloud storage -- as long as it implements the interface.

## Store Interfaces

### SettingsStore

Key-value store for settings and configuration.

```typescript
interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getMultiple<T>(keys: string[]): Promise<Record<string, T>>;
}
```

### MemoryStore

Virtual filesystem for agent files and memory.

```typescript
interface MemoryStore {
  read(agentId: string, path: string): Promise<string>;
  write(agentId: string, path: string, content: string): Promise<void>;
  append(agentId: string, path: string, content: string): Promise<void>;
  delete(agentId: string, path: string): Promise<void>;
  list(agentId: string, path?: string): Promise<FileEntry[]>;
  mkdir(agentId: string, path: string): Promise<void>;
  exists(agentId: string, path: string): Promise<boolean>;
  search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>>;
}
```

### ConversationStore

Stores conversation history per agent.

```typescript
interface ConversationStore {
  get(agentId: string, conversationId: string): Promise<Conversation | undefined>;
  list(agentId: string): Promise<Array<{ id: string; timestamp: string }>>;
  save(agentId: string, conversation: Conversation): Promise<void>;
  delete(agentId: string, conversationId: string): Promise<void>;
}
```

### HookStore

Stores hook configurations.

```typescript
interface HookStore {
  list(agentId?: string): Promise<Hook[]>;
  get(hookId: string): Promise<Hook | undefined>;
  add(hook: Hook): Promise<void>;
  update(hookId: string, updates: Partial<Hook>): Promise<void>;
  remove(hookId: string): Promise<void>;
}
```

### UsageStore

Stores usage/billing records.

```typescript
interface UsageStore {
  record(entry: UsageRecord): Promise<void>;
  query(options?: UsageQueryOptions): Promise<UsageRecord[]>;
  clear(): Promise<void>;
}
```

### AgentStore

Stores agent metadata.

```typescript
interface AgentStore {
  list(): Promise<AgentMeta[]>;
  get(agentId: string): Promise<AgentMeta | undefined>;
  add(agent: AgentMeta): Promise<void>;
  update(agentId: string, updates: Partial<AgentMeta>): Promise<void>;
  remove(agentId: string): Promise<void>;
}
```

## In-Memory Implementations

The SDK ships with in-memory implementations for all stores, suitable for development, testing, and ephemeral use cases.

Import from `@chaos/sdk/stores/in-memory`:

```typescript
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '@chaos/sdk/stores/in-memory';
```

Each class implements its respective interface using `Map` or array storage. Data is lost when the process exits.

### InMemoryMemoryStore Details

The `InMemoryMemoryStore` implements a full virtual filesystem:
- Files and directories are stored in a tree structure
- `write()` creates parent directories automatically
- `append()` creates the file if it does not exist
- `search()` does substring matching across all file contents
- `list()` returns sorted entries

## Creating Custom Stores

To create a custom store, implement the interface and pass it to `ChaosSDK`:

```typescript
import type { SettingsStore } from '@chaos/sdk/stores';

class PostgresSettingsStore implements SettingsStore {
  constructor(private db: Pool) {}

  async get<T>(key: string): Promise<T | undefined> {
    const result = await this.db.query('SELECT value FROM settings WHERE key = $1', [key]);
    return result.rows[0]?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, JSON.stringify(value)]
    );
  }

  async remove(key: string): Promise<void> {
    await this.db.query('DELETE FROM settings WHERE key = $1', [key]);
  }

  async getMultiple<T>(keys: string[]): Promise<Record<string, T>> {
    const result = await this.db.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    const out: Record<string, T> = {};
    for (const row of result.rows) {
      out[row.key] = row.value as T;
    }
    return out;
  }
}
```

### IndexedDB Example (Browser)

```typescript
import type { AgentStore } from '@chaos/sdk/stores';
import type { AgentMeta } from '@chaos/sdk';

class IDBAgentStore implements AgentStore {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('chaos-agents', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('agents', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async store(mode: IDBTransactionMode) {
    const db = await this.dbPromise;
    return db.transaction('agents', mode).objectStore('agents');
  }

  async list(): Promise<AgentMeta[]> {
    const s = await this.store('readonly');
    return new Promise((resolve, reject) => {
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(agentId: string): Promise<AgentMeta | undefined> {
    const s = await this.store('readonly');
    return new Promise((resolve, reject) => {
      const req = s.get(agentId);
      req.onsuccess = () => resolve(req.result ?? undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async add(agent: AgentMeta): Promise<void> {
    const s = await this.store('readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = s.put(agent);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async update(agentId: string, updates: Partial<AgentMeta>): Promise<void> {
    const existing = await this.get(agentId);
    if (!existing) throw new Error(`Agent not found: ${agentId}`);
    await this.add({ ...existing, ...updates });
  }

  async remove(agentId: string): Promise<void> {
    const s = await this.store('readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = s.delete(agentId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
```

## Using Custom Stores with the SDK

```typescript
const sdk = new ChaosSDK({
  settings: new PostgresSettingsStore(pool),
  memory: new FileSystemMemoryStore('/data/agents'),
  conversations: new PostgresConversationStore(pool),
  hooks: new InMemoryHookStore(),       // Mix and match
  usage: new PostgresUsageStore(pool),
  agentStore: new IDBAgentStore(),
});
```
