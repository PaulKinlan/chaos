/**
 * History Search Tool
 *
 * Searches the browser's browsing history.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const historySearch = tool({
  description:
    'Search the browsing history by query. Returns matching history items with title, URL, last visit time, and visit count.',
  parameters: z.object({
    query: z.string().describe('Search query to match against history entries'),
    maxResults: z
      .number()
      .default(20)
      .describe('Maximum number of results to return (default: 20)'),
    startTime: z
      .number()
      .optional()
      .describe('Start time as milliseconds since epoch. Only results after this time are returned.'),
  }),
  execute: async ({ query, maxResults, startTime }) => {
    try {
      const searchParams: chrome.history.HistoryQuery = {
        text: query,
        maxResults,
      };
      if (startTime !== undefined) {
        searchParams.startTime = startTime;
      }
      const results = await chrome.history.search(searchParams);
      return results.map((item) => ({
        title: item.title ?? '',
        url: item.url ?? '',
        lastVisitTime: item.lastVisitTime
          ? new Date(item.lastVisitTime).toISOString()
          : undefined,
        visitCount: item.visitCount ?? 0,
      }));
    } catch (err) {
      return {
        error: `Failed to search history: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
