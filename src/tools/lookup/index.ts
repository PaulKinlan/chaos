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

/**
 * Create a ToolLookup implementation with the given strategy.
 * All tools from the global registry are automatically registered.
 *
 * @param strategy - 'static' returns all tools, 'keyword' uses TF-IDF matching,
 *                   'embedding' stubs out vector similarity (falls back to keyword).
 */
export function createToolLookup(strategy: LookupStrategy = 'keyword'): ToolLookup {
  let lookup: ToolLookup;

  switch (strategy) {
    case 'static':
      lookup = new StaticLookup();
      break;
    case 'embedding':
      lookup = new EmbeddingLookup();
      break;
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
