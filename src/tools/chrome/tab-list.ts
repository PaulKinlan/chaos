/**
 * Tab List Tool
 *
 * Lists open browser tabs, optionally filtered by a query string.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabList = tool({
  description:
    'List open browser tabs. Optionally filter by a query string that matches against tab titles and URLs.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Optional search query to filter tabs by title or URL'),
  }),
  execute: async ({ query }) => {
    try {
      const tabs = await chrome.tabs.query({});
      let results = tabs.map((tab) => ({
        tabId: tab.id!,
        title: tab.title ?? '',
        url: tab.url ?? '',
        active: tab.active ?? false,
      }));

      if (query) {
        const q = query.toLowerCase();
        results = results.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.url.toLowerCase().includes(q),
        );
      }

      return results;
    } catch (err) {
      return {
        error: `Failed to list tabs: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
