/**
 * Model provider resolution for the TUI.
 * Reads --provider and --model flags, falls back to env vars.
 */

import type { AgentConfig } from '@chaos/agent-loop';

export type ProviderId = 'anthropic' | 'google' | 'openai' | 'ollama';

const DEFAULTS: Record<ProviderId, string> = {
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

export async function resolveModel(): Promise<AgentConfig['model']> {
  const provider = (parseFlag('provider') || process.env.CHAOS_PROVIDER || 'anthropic') as ProviderId;
  const modelId = parseFlag('model') || process.env.CHAOS_MODEL || DEFAULTS[provider] || DEFAULTS.anthropic;

  switch (provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey })(modelId) as unknown as AgentConfig['model'];
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('GOOGLE_API_KEY not set');
      return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as AgentConfig['model'];
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey })(modelId) as unknown as AgentConfig['model'];
    }
    case 'ollama': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({
        baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })(modelId) as unknown as AgentConfig['model'];
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
