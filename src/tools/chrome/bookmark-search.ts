/**
 * Bookmark Search Tool
 *
 * Searches all bookmarks by query string.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const bookmarkSearch = tool({
  description: 'Search bookmarks by a query string. Returns matching bookmarks with title, URL, and date added.',
  parameters: z.object({
    query: z.string().describe('Search query to match against bookmark titles and URLs'),
  }),
  execute: async ({ query }) => {
    try {
      const results = await chrome.bookmarks.search(query);
      return results
        .filter((b) => b.url) // exclude folders
        .map((b) => ({
          title: b.title,
          url: b.url!,
          dateAdded: b.dateAdded ? new Date(b.dateAdded).toISOString() : undefined,
        }));
    } catch (err) {
      return {
        error: `Failed to search bookmarks: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
