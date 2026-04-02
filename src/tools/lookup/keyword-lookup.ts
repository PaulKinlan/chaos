/**
 * Keyword Lookup
 *
 * Simple keyword/TF-IDF style matching for tool resolution.
 * Tokenizes the intent string and scores each tool by keyword overlap.
 */

import type { ToolLookup, ToolMeta } from './types.js';

/** Tokenize a string into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Score a tool against an array of intent tokens. */
function scoreTool(meta: ToolMeta, intentTokens: string[]): number {
  let score = 0;
  const allText = [
    ...meta.keywords,
    ...tokenize(meta.description),
    ...tokenize(meta.name.replace(/_/g, ' ')),
  ];

  for (const token of intentTokens) {
    for (const keyword of allText) {
      if (keyword === token) {
        // Exact match — full weight
        score += 1.0;
      } else if (keyword.includes(token) || token.includes(keyword)) {
        // Substring match — lower weight
        score += 0.4;
      }
    }
  }

  return score;
}

export class KeywordLookup implements ToolLookup {
  private tools: ToolMeta[] = [];

  register(meta: ToolMeta): void {
    this.tools.push(meta);
  }

  async resolve(intent: string, topK: number = 5): Promise<ToolMeta[]> {
    const intentTokens = tokenize(intent);

    if (intentTokens.length === 0) {
      return [];
    }

    const scored = this.tools
      .map((meta) => ({ meta, score: scoreTool(meta, intentTokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ meta }) => meta);
  }
}
