/**
 * Model pricing table for cost estimation.
 * Prices per 1M tokens in USD.
 * Last updated: April 2026 from official provider pricing pages.
 * Keep in a separate file for easy maintenance.
 */

export interface ModelPricing {
  input: number;
  output: number;
}

// Prices per 1M tokens in USD
const PRICING: Record<string, ModelPricing> = {
  // ── Anthropic (April 2026) ──
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-opus-4-5': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-opus-4-1': { input: 15.0, output: 75.0 },
  'claude-opus-4-0': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-0': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku': { input: 0.8, output: 4.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },

  // ── OpenAI (April 2026) ──
  'gpt-5': { input: 1.25, output: 10.0 },
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-5.3': { input: 2.5, output: 15.0 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o3': { input: 2.0, output: 8.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },

  // ── Google Gemini (April 2026) ──
  'gemini-3.1-pro': { input: 2.0, output: 12.0 },
  'gemini-3-flash': { input: 0.5, output: 3.0 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },

  // ── Mistral (April 2026) ──
  'mistral-large-3': { input: 0.5, output: 1.5 },
  'mistral-large': { input: 0.5, output: 1.5 },
  'mistral-medium-3': { input: 0.4, output: 2.0 },
  'mistral-medium': { input: 0.4, output: 2.0 },
  'mistral-small-3': { input: 0.075, output: 0.2 },
  'mistral-small': { input: 0.03, output: 0.11 },
  'codestral': { input: 0.3, output: 0.9 },
  'ministral-8b': { input: 0.15, output: 0.15 },
  'ministral-3b': { input: 0.1, output: 0.1 },

  // ── Groq (April 2026) ──
  'llama-4-scout': { input: 0.11, output: 0.34 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'qwen3-32b': { input: 0.29, output: 0.59 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },

  // ── Perplexity (April 2026) ──
  'sonar': { input: 1.0, output: 1.0 },
  'sonar-pro': { input: 3.0, output: 15.0 },
  'sonar-reasoning': { input: 2.0, output: 8.0 },
  'sonar-deep-research': { input: 2.0, output: 8.0 },

  // ── Ollama / Local (free) ──
  'llama3.2': { input: 0, output: 0 },
  'llama3': { input: 0, output: 0 },
  'mistral-local': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
  'deepseek-coder': { input: 0, output: 0 },
  'phi3': { input: 0, output: 0 },
  'gemma2': { input: 0, output: 0 },
  'qwen2.5': { input: 0, output: 0 },
};

// OpenRouter models use provider/model format — map to base model
function normalizeModelId(model: string): string {
  // Strip provider prefix for OpenRouter (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
  if (model.includes('/')) {
    return model.split('/').pop()!;
  }
  return model;
}

/**
 * Estimate cost in USD for a given model and token counts.
 * Returns 0 for unknown models (assumes free/local).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const normalized = normalizeModelId(model);
  // Try exact match, then prefix match (e.g. "claude-sonnet-4-6-20260301" matches "claude-sonnet-4-6")
  const prices = PRICING[normalized] ||
    Object.entries(PRICING).find(([key]) => normalized.startsWith(key))?.[1];
  if (!prices) return 0;
  return (inputTokens / 1_000_000) * prices.input +
    (outputTokens / 1_000_000) * prices.output;
}

/**
 * Get the pricing entry for a model, or undefined if not found.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  const normalized = normalizeModelId(model);
  return PRICING[normalized] ||
    Object.entries(PRICING).find(([key]) => normalized.startsWith(key))?.[1];
}
