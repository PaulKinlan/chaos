/**
 * Model pricing table for cost estimation.
 * Prices per 1M tokens in USD.
 * Updated periodically — keep in a separate file for easy maintenance.
 */

export interface ModelPricing {
  input: number;
  output: number;
}

// Prices per 1M tokens in USD
const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  // Google
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
  // OpenAI
  'gpt-5.4': { input: 2.5, output: 10.0 },
  'gpt-5.4-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Ollama (local, free)
  'llama3.2': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
  'deepseek-coder': { input: 0, output: 0 },
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
