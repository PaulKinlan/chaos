/**
 * Tool Lookup Factory
 *
 * Creates a ToolLookup implementation based on the chosen strategy.
 * Populates it with all registered tools from the tool registry.
 */

import type { ToolLookup } from './types.js';
import { toolRegistry } from './registry.js';
import { KeywordLookup } from './keyword-lookup.js';
import { StaticLookup } from './static-lookup.js';
import { EmbeddingLookup } from './embedding-lookup.js';

export type LookupStrategy = 'static' | 'keyword' | 'embedding';

export interface CreateToolLookupOptions {
  /** API key for embedding provider (required for embedding strategy) */
  apiKey?: string;
}

/**
 * Create a ToolLookup implementation with the given strategy.
 * All tools from the global registry are automatically registered.
 *
 * @param strategy - 'static' returns all tools, 'keyword' uses TF-IDF matching,
 *                   'embedding' uses API-based vector similarity (falls back to keyword if no API key).
 * @param options - Additional options like API key for embedding strategy.
 */
export function createToolLookup(
  strategy: LookupStrategy = 'keyword',
  options: CreateToolLookupOptions = {},
): ToolLookup {
  let lookup: ToolLookup;

  switch (strategy) {
    case 'static':
      lookup = new StaticLookup();
      break;
    case 'embedding': {
      const embeddingLookup = new EmbeddingLookup();
      lookup = embeddingLookup;

      // Populate tools first so they're available for embedding
      for (const meta of toolRegistry.getAll()) {
        lookup.register(meta);
      }

      // Initialize embeddings in the background if an API key is provided
      if (options.apiKey) {
        embeddingLookup.initialize(options.apiKey).catch((err) => {
          console.warn('Failed to initialize embedding lookup:', err);
        });
      }

      return lookup;
    }
    case 'keyword':
    default:
      lookup = new KeywordLookup();
      break;
  }

  // Populate from the global registry
  for (const meta of toolRegistry.getAll()) {
    lookup.register(meta);
  }

  return lookup;
}

// Re-export types and registry for convenience
export type { ToolLookup, ToolMeta } from './types.js';
export type { LookupStrategy as ToolLookupStrategy };
export { toolRegistry } from './registry.js';
