/**
 * Static Lookup
 *
 * Returns all registered tools regardless of intent.
 * Useful as a fallback and for testing.
 */

import type { ToolLookup, ToolMeta } from './types.js';

export class StaticLookup implements ToolLookup {
  private tools: ToolMeta[] = [];

  register(meta: ToolMeta): void {
    this.tools.push(meta);
  }

  async resolve(_intent: string, _topK?: number): Promise<ToolMeta[]> {
    return [...this.tools];
  }
}
