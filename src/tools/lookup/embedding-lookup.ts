/**
 * Embedding Lookup
 *
 * Implements the ToolLookup interface using API-based embeddings for
 * semantic similarity search. Falls back to keyword lookup when no
 * API key is available or embeddings haven't been initialized.
 *
 * Uses the AI provider's embedding API (text-embedding-3-small via OpenAI)
 * and caches tool embeddings in IndexedDB.
 */

import type { ToolLookup, ToolMeta } from './types.js';
import { KeywordLookup } from './keyword-lookup.js';
import { getEmbedding, setEmbedding } from '../../storage/idb.js';

// ── Cosine similarity ──

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Compute a simple hash of a string for cache invalidation.
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// ── Types for embed function ──

interface EmbedResult {
  embedding: number[];
}

type EmbedFunction = (params: { model: unknown; value: string }) => Promise<EmbedResult>;

export class EmbeddingLookup implements ToolLookup {
  /** Fallback to keyword lookup when embeddings are not available */
  private fallback = new KeywordLookup();

  /** All registered tool metadata */
  private tools: ToolMeta[] = [];

  /** Cached tool vectors for cosine similarity */
  private toolVectors: Map<string, number[]> = new Map();

  /** Whether embeddings have been initialized */
  private initialized = false;

  /** API key for the embedding provider */
  private apiKey: string | null = null;

  /** The embed function (injected for testability) */
  private embedFn: EmbedFunction | null = null;

  /** The embedding model factory (injected for testability) */
  private modelFactory: ((apiKey: string) => unknown) | null = null;

  /**
   * Initialize the embedding lookup with an API key.
   * Embeds all registered tool descriptions and caches them in IndexedDB.
   * Only re-embeds if tool descriptions have changed (based on hash).
   */
  async initialize(
    apiKey: string,
    embedFn?: EmbedFunction,
    modelFactory?: (apiKey: string) => unknown,
  ): Promise<void> {
    this.apiKey = apiKey;

    // Use injected functions or dynamically import the real ones
    if (embedFn && modelFactory) {
      this.embedFn = embedFn;
      this.modelFactory = modelFactory;
    } else {
      try {
        const { embed } = await import('ai');
        const { createOpenAI } = await import('@ai-sdk/openai');
        this.embedFn = embed as unknown as EmbedFunction;
        this.modelFactory = (key: string) => {
          const provider = createOpenAI({ apiKey: key });
          return provider.textEmbeddingModel('text-embedding-3-small');
        };
      } catch {
        // AI SDK not available — stay in fallback mode
        return;
      }
    }

    const model = this.modelFactory(apiKey);

    // Build the description hash for cache invalidation
    const allDescriptions = this.tools
      .map((t) => `${t.name}:${t.description} ${t.keywords.join(' ')}`)
      .join('|');
    const currentHash = hashString(allDescriptions);

    // Check if IndexedDB is available for caching
    const idbAvailable = typeof indexedDB !== 'undefined';

    // Check if cached embeddings are still valid
    let cacheValid = false;
    if (idbAvailable) {
      try {
        const hashEntry = await getEmbedding('tool-descriptions-hash');
        cacheValid = !!(hashEntry && hashEntry.text === currentHash);

        if (cacheValid) {
          // Load cached embeddings from IndexedDB
          for (const tool of this.tools) {
            const cached = await getEmbedding(`tool:${tool.name}`);
            if (cached && cached.vector.length > 0) {
              this.toolVectors.set(tool.name, cached.vector);
            }
          }

          // Only re-embed tools that are missing from cache
          const missingTools = this.tools.filter((t) => !this.toolVectors.has(t.name));
          if (missingTools.length === 0) {
            this.initialized = true;
            return;
          }
        }
      } catch {
        // IndexedDB operations failed — proceed without cache
      }
    }

    // Embed all tool descriptions
    for (const tool of this.tools) {
      if (cacheValid && this.toolVectors.has(tool.name)) continue;

      try {
        const text = `${tool.description} ${tool.keywords.join(' ')}`;
        const result = await this.embedFn({ model, value: text });
        this.toolVectors.set(tool.name, result.embedding);

        // Cache in IndexedDB if available
        if (idbAvailable) {
          try {
            await setEmbedding({
              id: `tool:${tool.name}`,
              sourceType: 'tool',
              sourceId: tool.name,
              text,
              vector: result.embedding,
            });
          } catch {
            // Cache write failed — not critical
          }
        }
      } catch (err) {
        console.warn(`Failed to embed tool ${tool.name}:`, err);
      }
    }

    // Store the hash for future cache validation
    if (idbAvailable) {
      try {
        await setEmbedding({
          id: 'tool-descriptions-hash',
          sourceType: 'tool',
          sourceId: 'hash',
          text: currentHash,
          vector: [],
        });
      } catch {
        // Cache write failed — not critical
      }
    }

    this.initialized = true;
  }

  register(meta: ToolMeta): void {
    this.tools.push(meta);
    this.fallback.register(meta);
  }

  async resolve(intent: string, topK: number = 5): Promise<ToolMeta[]> {
    // Fall back to keyword lookup if embeddings are not initialized
    if (!this.initialized || !this.embedFn || !this.apiKey || !this.modelFactory) {
      return this.fallback.resolve(intent, topK);
    }

    try {
      const model = this.modelFactory(this.apiKey);
      const result = await this.embedFn({ model, value: intent });
      const intentVector = result.embedding;

      const scored: { meta: ToolMeta; similarity: number }[] = [];
      for (const tool of this.tools) {
        const toolVector = this.toolVectors.get(tool.name);
        if (!toolVector) continue;
        const similarity = cosineSimilarity(intentVector, toolVector);
        scored.push({ meta: tool, similarity });
      }

      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, topK).map((s) => s.meta);
    } catch (err) {
      console.warn('Embedding lookup failed, falling back to keyword:', err);
      return this.fallback.resolve(intent, topK);
    }
  }
}
