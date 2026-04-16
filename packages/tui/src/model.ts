/**
 * Model provider resolution for the TUI.
 * Models and defaults match the extension's provider-registry.ts exactly.
 */

import type { AgentConfig } from 'agent-do';

export type ProviderId = 'anthropic' | 'google' | 'openai' | 'openrouter' | 'ollama';

// Matches extension/src/agents/provider-registry.ts
export const PROVIDERS: Record<ProviderId, {
  displayName: string;
  defaultModel: string;
  models: Array<{ id: string; displayName: string }>;
}> = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    ],
  },
  google: {
    displayName: 'Google (Gemini)',
    defaultModel: 'gemini-3.1-pro-preview',
    models: [
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (Preview)' },
      { id: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash Lite (Preview)' },
      { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    ],
  },
  openai: {
    displayName: 'OpenAI',
    defaultModel: 'gpt-5.4',
    models: [
      { id: 'gpt-5.4', displayName: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', displayName: 'GPT-5.4 Nano' },
      { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex' },
    ],
  },
  openrouter: {
    displayName: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4-6',
    models: [
      { id: 'anthropic/claude-opus-4-7', displayName: 'Claude Opus 4.7 (via OR)' },
      { id: 'anthropic/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (via OR)' },
      { id: 'anthropic/claude-opus-4-6', displayName: 'Claude Opus 4.6 (via OR)' },
      { id: 'google/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (via OR)' },
      { id: 'google/gemini-3-flash', displayName: 'Gemini 3 Flash (via OR)' },
      { id: 'openai/gpt-5.4', displayName: 'GPT-5.4 (via OR)' },
      { id: 'openai/gpt-5.4-mini', displayName: 'GPT-5.4 Mini (via OR)' },
    ],
  },
  ollama: {
    displayName: 'Ollama (Local)',
    defaultModel: 'llama3.2',
    models: [
      { id: 'llama3.2', displayName: 'Llama 3.2' },
      { id: 'llama3.2:70b', displayName: 'Llama 3.2 70B' },
      { id: 'mistral', displayName: 'Mistral' },
      { id: 'codellama', displayName: 'Code Llama' },
      { id: 'gemma2', displayName: 'Gemma 2' },
      { id: 'phi3', displayName: 'Phi-3' },
      { id: 'qwen2.5-coder', displayName: 'Qwen 2.5 Coder' },
    ],
  },
};

// Matches extension/src/agents/pricing.ts
export const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  // OpenAI
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-5.4-mini': { input: 0.4, output: 1.6 },
  'gpt-5.4-nano': { input: 0.1, output: 0.4 },
  'gpt-5.3-codex': { input: 2.5, output: 15.0 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  // Google
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'gemini-3-flash': { input: 0.5, output: 3.0 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // Ollama (free)
  'llama3.2': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
  'gemma2': { input: 0, output: 0 },
  'phi3': { input: 0, output: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const normalized = model.includes('/') ? model.split('/').pop()! : model;
  const prices = PRICING[normalized] ||
    Object.entries(PRICING).find(([key]) => normalized.startsWith(key))?.[1];
  if (!prices) return 0;
  return (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output;
}

export function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

export async function resolveModelFor(
  provider: string,
  modelId?: string,
): Promise<AgentConfig['model']> {
  const pid = provider as ProviderId;
  const providerConfig = PROVIDERS[pid];
  const mid = modelId || providerConfig?.defaultModel || 'claude-sonnet-4-6';

  switch (pid) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey })(mid) as unknown as AgentConfig['model'];
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('GOOGLE_API_KEY not set');
      return createGoogleGenerativeAI({ apiKey })(mid) as unknown as AgentConfig['model'];
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey })(mid) as unknown as AgentConfig['model'];
    }
    case 'openrouter': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
      return createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })(mid) as unknown as AgentConfig['model'];
    }
    case 'ollama': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({
        baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })(mid) as unknown as AgentConfig['model'];
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function resolveModel(): Promise<AgentConfig['model']> {
  const provider = parseFlag('provider') || process.env.CHAOS_PROVIDER || 'anthropic';
  const modelId = parseFlag('model') || process.env.CHAOS_MODEL || undefined;
  return resolveModelFor(provider, modelId);
}
