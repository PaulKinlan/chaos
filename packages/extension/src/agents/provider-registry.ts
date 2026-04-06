/**
 * Provider Registry
 *
 * Simplified provider registry for CHAOS. Defines available AI providers,
 * their models, and factory functions for creating model instances via
 * the Vercel AI SDK.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, ToolSet } from 'ai';

// ── Types ──

export type ProviderId = 'anthropic' | 'google' | 'openai' | 'openrouter' | 'ollama';

export interface ProviderFeatures {
  supportsVision: boolean;
  requiresApiKey: boolean;
  authStyle: 'bearer' | 'x-api-key';
}

export interface ModelInfo {
  id: string;
  displayName: string;
}

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  defaultModel: string;
  models: ModelInfo[];
  features: ProviderFeatures;
  supportsBaseUrl: boolean;  // whether users can override the API endpoint
  createModel: (apiKey: string, modelId?: string, baseURL?: string) => LanguageModel;
}

// ── Provider definitions ──

const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  displayName: 'Anthropic (Claude)',
  defaultModel: 'claude-sonnet-4-6',
  models: [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  ],
  features: {
    supportsVision: true,
    requiresApiKey: true,
    authStyle: 'x-api-key',
  },
  supportsBaseUrl: true,
  createModel: (apiKey, modelId, baseURL) => {
    const provider = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
    return provider(modelId ?? 'claude-sonnet-4-6');
  },
};

const googleProvider: ProviderConfig = {
  id: 'google',
  displayName: 'Google (Gemini)',
  defaultModel: 'gemini-3.1-pro-preview',
  models: [
    { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (Preview)' },
    { id: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash Lite (Preview)' },
    { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  ],
  features: {
    supportsVision: true,
    requiresApiKey: true,
    authStyle: 'bearer',
  },
  supportsBaseUrl: true,
  createModel: (apiKey, modelId, baseURL) => {
    const provider = createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    return provider(modelId ?? 'gemini-3.1-pro-preview');
  },
};

const openaiProvider: ProviderConfig = {
  id: 'openai',
  displayName: 'OpenAI',
  defaultModel: 'gpt-5.4',
  models: [
    { id: 'gpt-5.4', displayName: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', displayName: 'GPT-5.4 Nano' },
    { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex' },
  ],
  features: {
    supportsVision: true,
    requiresApiKey: true,
    authStyle: 'bearer',
  },
  supportsBaseUrl: true,
  createModel: (apiKey, modelId, baseURL) => {
    const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    return provider(modelId ?? 'gpt-5.4');
  },
};

const openrouterProvider: ProviderConfig = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  defaultModel: 'anthropic/claude-sonnet-4-6',
  models: [
    // OpenRouter supports many models — these are common defaults.
    // Users can specify any model ID supported by OpenRouter.
    { id: 'anthropic/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (via OpenRouter)' },
    { id: 'anthropic/claude-opus-4-6', displayName: 'Claude Opus 4.6 (via OpenRouter)' },
    { id: 'google/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (via OpenRouter)' },
    { id: 'google/gemini-3-flash', displayName: 'Gemini 3 Flash (via OpenRouter)' },
    { id: 'openai/gpt-5.4', displayName: 'GPT-5.4 (via OpenRouter)' },
    { id: 'openai/gpt-5.4-mini', displayName: 'GPT-5.4 Mini (via OpenRouter)' },
  ],
  features: {
    supportsVision: true,
    requiresApiKey: true,
    authStyle: 'bearer',
  },
  supportsBaseUrl: false, // OpenRouter IS the base URL
  createModel: (apiKey, modelId) => {
    // OpenRouter uses an OpenAI-compatible API
    const provider = createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    return provider(modelId ?? 'anthropic/claude-sonnet-4-6');
  },
};

const ollamaProvider: ProviderConfig = {
  id: 'ollama',
  displayName: 'Ollama (Local)',
  defaultModel: 'llama3.2',
  models: [
    // Common Ollama models — users can specify any installed model
    { id: 'llama3.2', displayName: 'Llama 3.2' },
    { id: 'llama3.2:70b', displayName: 'Llama 3.2 70B' },
    { id: 'mistral', displayName: 'Mistral' },
    { id: 'codellama', displayName: 'Code Llama' },
    { id: 'gemma2', displayName: 'Gemma 2' },
    { id: 'phi3', displayName: 'Phi-3' },
    { id: 'qwen2.5-coder', displayName: 'Qwen 2.5 Coder' },
  ],
  features: {
    supportsVision: false,
    requiresApiKey: false,
    authStyle: 'bearer',
  },
  supportsBaseUrl: true,
  createModel: (_apiKey, modelId, baseURL) => {
    // Ollama exposes an OpenAI-compatible API
    const provider = createOpenAI({
      apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
      baseURL: baseURL || 'http://localhost:11434/v1',
    });
    return provider(modelId ?? 'llama3.2');
  },
};

// ── Registry ──

const providers: Record<ProviderId, ProviderConfig> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
};

/** Get a provider configuration by ID. */
export function getProvider(id: ProviderId): ProviderConfig {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

/** List all available providers. */
export function listProviders(): ProviderConfig[] {
  return Object.values(providers);
}

/** Get the default provider. */
export function getDefaultProvider(): ProviderConfig {
  return providers.anthropic;
}

// ── Dynamic model fetching ──

export interface ModelOption {
  value: string;
  label: string;
}

/** Get the curated model list for a provider. Use the custom model input for unlisted models. */
export function getFallbackModels(providerId: string): ModelOption[] {
  const provider = providers[providerId as ProviderId];
  if (!provider) return [];
  return provider.models.map((m) => ({ value: m.id, label: m.displayName }));
}

/**
 * Create a language model instance for the given provider and API key.
 * If modelId is not specified, uses the provider's default model.
 */
export function createLanguageModel(
  providerId: ProviderId,
  apiKey: string,
  modelId?: string,
  baseURL?: string,
): LanguageModel {
  const provider = getProvider(providerId);
  return provider.createModel(apiKey, modelId ?? provider.defaultModel, baseURL);
}

/**
 * Get provider-native search tools for the active provider.
 * These are server-side search tools handled by the provider's API,
 * not custom tools we implement. Returns an empty object if the
 * provider doesn't support native search.
 */
export function getProviderSearchTools(
  providerId: ProviderId,
  apiKey: string,
): ToolSet {
  try {
    switch (providerId) {
      case 'google': {
        const google = createGoogleGenerativeAI({ apiKey });
        return {
          google_search: google.tools.googleSearch({}),
        } as ToolSet;
      }
      case 'openai': {
        const openai = createOpenAI({ apiKey });
        return {
          web_search: openai.tools.webSearchPreview({}),
        } as ToolSet;
      }
      case 'anthropic': {
        const anthropic = createAnthropic({ apiKey });
        return {
          web_search: anthropic.tools.webSearch_20260209({}),
        } as ToolSet;
      }
      case 'openrouter':
        // OpenRouter uses an OpenAI-compatible API but provider-specific
        // tools may not be supported through the proxy. Skip gracefully.
        return {};
      default:
        return {};
    }
  } catch {
    // If the provider doesn't support search tools, return empty
    return {};
  }
}
