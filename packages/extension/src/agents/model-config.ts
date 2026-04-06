/**
 * Agent Model Configuration
 *
 * Resolves the effective provider, model, and API key for a given agent.
 * Agent-level overrides take priority over global settings.
 */

import { getAgentList, getApiKeys, getSettings } from '../storage/chrome-storage.js';
import type { ProviderId } from './provider-registry.js';
import { getProvider } from './provider-registry.js';

export interface AgentModelConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

/**
 * Resolve the effective model configuration for an agent.
 *
 * Resolution order:
 * 1. agent.provider overrides global settings.activeProvider
 * 2. agent.model overrides global settings.model, which overrides provider default
 * 3. API key is looked up from the global pool based on the resolved provider
 */
export async function getAgentModelConfig(agentId: string): Promise<AgentModelConfig> {
  const [agents, settings, apiKeys] = await Promise.all([
    getAgentList(),
    getSettings(),
    getApiKeys(),
  ]);

  const agent = agents.find((a) => a.id === agentId);

  // Resolve provider: agent override -> global setting
  const provider = (agent?.provider || settings.activeProvider) as ProviderId;

  // Resolve model: agent override -> global setting -> provider default
  const providerConfig = getProvider(provider);
  const model = agent?.model || settings.model || providerConfig.defaultModel;

  // Resolve API key from the global pool for the resolved provider
  const apiKey = apiKeys[provider];
  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${provider}`);
  }

  return { provider, model, apiKey };
}
