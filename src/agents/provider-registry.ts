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
import type { LanguageModel } from 'ai';

// ── Types ──

export type ProviderId = 'anthropic' | 'google' | 'openai' | 'openrouter';

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
  createModel: (apiKey: string, modelId?: string) => LanguageModel;
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
  createModel: (apiKey, modelId) => {
    const provider = createAnthropic({ apiKey });
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
  createModel: (apiKey, modelId) => {
    const provider = createGoogleGenerativeAI({ apiKey });
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
  createModel: (apiKey, modelId) => {
    const provider = createOpenAI({ apiKey });
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
  createModel: (apiKey, modelId) => {
    // OpenRouter uses an OpenAI-compatible API
    const provider = createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    return provider(modelId ?? 'anthropic/claude-sonnet-4-6');
  },
};

// ── Registry ──

const providers: Record<ProviderId, ProviderConfig> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
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
): LanguageModel {
  const provider = getProvider(providerId);
  return provider.createModel(apiKey, modelId ?? provider.defaultModel);
}
