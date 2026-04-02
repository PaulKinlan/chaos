/**
 * IndexedDB wrapper using Jake Archibald's `idb` library.
 *
 * Database: chaos-db, version 1
 * Stores: conversations, tool-configs, page-cache, embeddings
 */

import { openDB, type IDBPDatabase } from 'idb';
import type {
  Conversation,
  ToolConfig,
  PageCache,
  Embedding,
} from './types.js';

// ── Schema ──

interface ChaosDBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-agent': string };
  };
  'tool-configs': {
    key: string;
    value: ToolConfig;
  };
  'page-cache': {
    key: string;   // URL
    value: PageCache;
    indexes: { 'by-agent': string };
  };
  embeddings: {
    key: string;
    value: Embedding;
    indexes: { 'by-source': string };
  };
}

// ── Database singleton ──

let dbPromise: Promise<IDBPDatabase<ChaosDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<ChaosDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ChaosDBSchema>('chaos-db', 1, {
      upgrade(db) {
        // conversations
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-agent', 'agentId');

        // tool-configs
        db.createObjectStore('tool-configs', { keyPath: 'id' });

        // page-cache
        const pageStore = db.createObjectStore('page-cache', { keyPath: 'url' });
        pageStore.createIndex('by-agent', 'agentId');

        // embeddings
        const embStore = db.createObjectStore('embeddings', { keyPath: 'id' });
        embStore.createIndex('by-source', 'sourceId');
      },
    });
  }
  return dbPromise;
}

// ── Conversations ──

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function setConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function listConversations(agentId?: string): Promise<Conversation[]> {
  const db = await getDB();
  if (agentId) {
    return db.getAllFromIndex('conversations', 'by-agent', agentId);
  }
  return db.getAll('conversations');
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('conversations', id);
}

// ── Tool Configs ──

export async function getToolConfig(id: string): Promise<ToolConfig | undefined> {
  const db = await getDB();
  return db.get('tool-configs', id);
}

export async function setToolConfig(config: ToolConfig): Promise<void> {
  const db = await getDB();
  await db.put('tool-configs', config);
}

export async function listToolConfigs(): Promise<ToolConfig[]> {
  const db = await getDB();
  return db.getAll('tool-configs');
}

export async function deleteToolConfig(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('tool-configs', id);
}

// ── Page Cache ──

export async function getPageCache(url: string): Promise<PageCache | undefined> {
  const db = await getDB();
  return db.get('page-cache', url);
}

export async function setPageCache(page: PageCache): Promise<void> {
  const db = await getDB();
  await db.put('page-cache', page);
}

export async function listPageCache(agentId?: string): Promise<PageCache[]> {
  const db = await getDB();
  if (agentId) {
    return db.getAllFromIndex('page-cache', 'by-agent', agentId);
  }
  return db.getAll('page-cache');
}

export async function deletePageCache(url: string): Promise<void> {
  const db = await getDB();
  await db.delete('page-cache', url);
}

// ── Embeddings ──

export async function getEmbedding(id: string): Promise<Embedding | undefined> {
  const db = await getDB();
  return db.get('embeddings', id);
}

export async function setEmbedding(embedding: Embedding): Promise<void> {
  const db = await getDB();
  await db.put('embeddings', embedding);
}

export async function listEmbeddings(sourceId?: string): Promise<Embedding[]> {
  const db = await getDB();
  if (sourceId) {
    return db.getAllFromIndex('embeddings', 'by-source', sourceId);
  }
  return db.getAll('embeddings');
}

export async function deleteEmbedding(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('embeddings', id);
}

/** Reset the DB singleton (useful for testing). */
export function _resetDB(): void {
  dbPromise = null;
}
