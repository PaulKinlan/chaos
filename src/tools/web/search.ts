/**
 * Web Search Tool
 *
 * Real web search using DuckDuckGo Instant Answer API (free, no key needed)
 * with optional Brave Search API for better results when a key is configured.
 */

import { tool } from 'ai';
import { z } from 'zod';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Heading?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{
      Text?: string;
      FirstURL?: string;
    }>;
  }>;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

/**
 * Search using DuckDuckGo Instant Answer API (no key required).
 */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as DuckDuckGoResponse;
  const results: SearchResult[] = [];

  // Add the abstract/instant answer if available
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || data.AbstractSource || 'Instant Answer',
      url: data.AbstractURL,
      description: data.AbstractText,
    });
  }

  // Add related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= 10) break;

      if (topic.Text && topic.FirstURL) {
        // Extract title from text (DuckDuckGo format: "Title - Description")
        const parts = topic.Text.split(' - ');
        results.push({
          title: parts[0] || topic.Text.slice(0, 80),
          url: topic.FirstURL,
          description: topic.Text,
        });
      }

      // Handle sub-topics (nested groups)
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (results.length >= 10) break;
          if (sub.Text && sub.FirstURL) {
            const parts = sub.Text.split(' - ');
            results.push({
              title: parts[0] || sub.Text.slice(0, 80),
              url: sub.FirstURL,
              description: sub.Text,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Search using Brave Search API (requires API key, better results).
 */
async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results: SearchResult[] = [];

  if (data.web?.results) {
    for (const item of data.web.results) {
      if (results.length >= 10) break;
      results.push({
        title: item.title || '',
        url: item.url || '',
        description: item.description || '',
      });
    }
  }

  return results;
}

/**
 * Create the web search tool, optionally configured with a Brave Search API key.
 */
export function createWebSearch(braveApiKey?: string) {
  return tool({
    description:
      'Search the web for information. Returns a list of results with titles, URLs, and descriptions. ' +
      'Use fetch_page on result URLs to get full page content.',
    parameters: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async ({ query }) => {
      try {
        // Use Brave Search if API key is available (better results)
        if (braveApiKey) {
          try {
            const results = await searchBrave(query, braveApiKey);
            if (results.length > 0) {
              return { source: 'brave', query, results };
            }
          } catch {
            // Fall through to DuckDuckGo
          }
        }

        // DuckDuckGo as default/fallback
        const results = await searchDuckDuckGo(query);
        if (results.length > 0) {
          return { source: 'duckduckgo', query, results };
        }

        // If DuckDuckGo returns no results, provide a helpful fallback
        return {
          source: 'none',
          query,
          results: [],
          message:
            'No results found. Try rephrasing the query, or use fetch_page with a ' +
            'specific URL if you know where to look.',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          source: 'error',
          query,
          results: [],
          error: `Search failed: ${message}`,
        };
      }
    },
  });
}

/**
 * Default web search tool (DuckDuckGo only, no API key needed).
 * Use createWebSearch(braveApiKey) for Brave Search support.
 */
export const webSearch = createWebSearch();
