/**
 * Provider-native tools — built-in tools from each AI SDK provider.
 *
 * These tools run server-side with the provider's infrastructure and are
 * far superior to our custom implementations (e.g. DuckDuckGo scraping).
 */

import type { ToolSet } from 'ai';
import type { ProviderId } from './model.js';

export async function getProviderTools(provider: ProviderId): Promise<ToolSet> {
  const tools: ToolSet = {};

  try {
    switch (provider) {
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

        tools.web_search = anthropic.tools.webSearch_20260209();
        tools.web_fetch = anthropic.tools.webFetch_20260209();
        tools.code_execution = anthropic.tools.codeExecution_20260120();

        console.log('[provider-tools] Anthropic: web_search, web_fetch, code_execution');
        break;
      }

      case 'openai': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

        tools.web_search = openai.tools.webSearch();

        console.log('[provider-tools] OpenAI: web_search');
        break;
      }

      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || '' });

        tools.google_search = google.tools.googleSearch({});
        tools.code_execution = google.tools.codeExecution({});
        tools.url_context = google.tools.urlContext({});

        console.log('[provider-tools] Google: google_search, code_execution, url_context');
        break;
      }

      case 'openrouter':
      case 'ollama':
        // No native tools for these
        break;
    }
  } catch (err) {
    console.warn(`[provider-tools] Failed to load ${provider} tools:`, err);
  }

  return tools;
}
