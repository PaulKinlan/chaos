/**
 * Model provider resolution for the TUI.
 * Reads --provider and --model flags, falls back to env vars.
 */

import type { AgentConfig } from '@chaos/agent-loop';

export type ProviderId = 'anthropic' | 'google' | 'openai' | 'ollama';

export const DEFAULTS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  ollama: 'llama3.2',
};

export function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

/**
 * Resolve a model by provider and model ID.
 * Used both for the default model and per-agent overrides.
 */
export async function resolveModelFor(
  provider: string,
  modelId?: string,
): Promise<AgentConfig['model']> {
  const pid = provider as ProviderId;
  const mid = modelId || DEFAULTS[pid] || DEFAULTS.anthropic;

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

/** Resolve the default model from CLI flags / env vars. */
export async function resolveModel(): Promise<AgentConfig['model']> {
  const provider = parseFlag('provider') || process.env.CHAOS_PROVIDER || 'anthropic';
  const modelId = parseFlag('model') || process.env.CHAOS_MODEL || undefined;
  return resolveModelFor(provider, modelId);
}
