/**
 * Model pricing table for cost estimation.
 * Prices per 1M tokens in USD.
 * Synced from NotebookLM-Chrome provider-registry.ts pricing data.
 * Updated periodically — keep in a separate file for easy maintenance.
 */

export interface ModelPricing {
  input: number;
  output: number;
}

// Prices per 1M tokens in USD
const PRICING: Record<string, ModelPricing> = {
  // ── Anthropic ──
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-4-opus': { input: 15.0, output: 75.0 },
  'claude-4-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku': { input: 0.8, output: 4.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },

  // ── OpenAI ──
  'gpt-5': { input: 5.0, output: 15.0 },
  'gpt-5-mini': { input: 0.3, output: 1.2 },
  'gpt-5.4': { input: 2.5, output: 10.0 },
  'gpt-5.4-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3': { input: 10.0, output: 40.0 },
  'o3-mini': { input: 1.1, output: 4.4 },

  // ── Google (Gemini) ──
  'gemini-3-pro': { input: 1.25, output: 5.0 },
  'gemini-3-flash': { input: 0.075, output: 0.3 },
  'gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.5-flash-lite': { input: 0.02, output: 0.08 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.025, output: 0.1 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },

  // ── Mistral ──
  'mistral-large': { input: 2.0, output: 6.0 },
  'mistral-medium': { input: 2.7, output: 8.1 },
  'mistral-small': { input: 0.2, output: 0.6 },
  'codestral': { input: 0.2, output: 0.6 },

  // ── Groq ──
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },

  // ── Perplexity ──
  'sonar': { input: 1.0, output: 1.0 },
  'sonar-pro': { input: 3.0, output: 15.0 },
  'sonar-reasoning': { input: 1.0, output: 5.0 },

  // ── Ollama / Local (free) ──
  'llama3.2': { input: 0, output: 0 },
  'llama3': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
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
