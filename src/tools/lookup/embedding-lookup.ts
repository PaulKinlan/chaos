/**
 * Embedding Lookup (Stub)
 *
 * Implements the ToolLookup interface with a placeholder for embedding-based
 * similarity search. Currently falls back to keyword lookup.
 *
 * When a real embedding model is added:
 * 1. Initialize the model in init()
 * 2. Embed tool descriptions on register()
 * 3. Embed the intent on resolve() and do cosine similarity
 * 4. Store/retrieve embeddings from the IndexedDB 'embeddings' store
 */

import type { ToolLookup, ToolMeta } from './types.js';
import { KeywordLookup } from './keyword-lookup.js';
// TODO: Import IDB embedding helpers when ready
// import { setEmbedding, listEmbeddings } from '../../storage/idb.js';

export class EmbeddingLookup implements ToolLookup {
  /** Fallback to keyword lookup until embeddings are implemented */
  private fallback = new KeywordLookup();

  // TODO: Embedding model instance
  // private model: EmbeddingModel | null = null;

  // TODO: Cached tool vectors for cosine similarity
  // private toolVectors: Map<string, number[]> = new Map();

  /**
   * Initialize the embedding model.
   * TODO: Load a local embedding model (e.g. transformers.js or ONNX).
   */
  async init(): Promise<void> {
    // TODO: Initialize embedding model
    // this.model = await loadEmbeddingModel();
    //
    // Re-embed all registered tools:
    // for (const meta of this.fallback tools) {
    //   const vector = await this.model.embed(meta.description);
    //   this.toolVectors.set(meta.name, vector);
    //   await setEmbedding({
    //     id: `tool:${meta.name}`,
    //     sourceType: 'tool',
    //     sourceId: meta.name,
    //     text: meta.description,
    //     vector,
    //   });
    // }
  }

  register(meta: ToolMeta): void {
    this.fallback.register(meta);

    // TODO: Embed the tool description and store the vector
    // if (this.model) {
    //   const vector = await this.model.embed(meta.description);
    //   this.toolVectors.set(meta.name, vector);
    //   await setEmbedding({
    //     id: `tool:${meta.name}`,
    //     sourceType: 'tool',
    //     sourceId: meta.name,
    //     text: meta.description,
    //     vector,
    //   });
    // }
  }

  async resolve(intent: string, topK: number = 5): Promise<ToolMeta[]> {
    // TODO: When embedding model is available, do cosine similarity search:
    // if (this.model) {
    //   const intentVector = await this.model.embed(intent);
    //   const scored = [];
    //   for (const [name, toolVector] of this.toolVectors) {
    //     const similarity = cosineSimilarity(intentVector, toolVector);
    //     scored.push({ name, similarity });
    //   }
    //   scored.sort((a, b) => b.similarity - a.similarity);
    //   return scored.slice(0, topK).map(s => this.getToolByName(s.name)!);
    // }

    // Fallback to keyword matching
    return this.fallback.resolve(intent, topK);
  }
}
