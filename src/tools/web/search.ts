/**
 * Web Search Tool
 *
 * Placeholder search tool that directs agents to use tab_open + tab_read
 * for web searching, since we cannot easily use search APIs without keys.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const webSearch = tool({
  description:
    'Search the web. Currently delegates to tab-based browsing — use tab_open to open a search URL and tab_read to read results.',
  parameters: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }) => {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.google.com/search?q=${encodedQuery}`;

    return {
      message:
        'Direct web search is not available without API keys. ' +
        'Use tab_open to open a search URL and tab_read to read the results.',
      suggestedAction: `Use tab_open with url "${searchUrl}" then tab_read on the opened tab.`,
      searchUrl,
    };
  },
});
