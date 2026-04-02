/**
 * Reading List Query Tool
 *
 * Queries the Chrome reading list.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const readingListQuery = tool({
  description:
    'Query the browser reading list. Optionally filter by URL or read/unread status.',
  inputSchema: z.object({
    url: z.string().optional().describe('Filter by URL'),
    hasBeenRead: z.boolean().optional().describe('Filter by read status (true = read, false = unread)'),
  }),
  execute: async ({ url, hasBeenRead }) => {
    try {
      const query: { url?: string; hasBeenRead?: boolean } = {};
      if (url !== undefined) query.url = url;
      if (hasBeenRead !== undefined) query.hasBeenRead = hasBeenRead;

      const entries = await chrome.readingList.query(query);
      return entries.map((e: chrome.readingList.ReadingListEntry) => ({
        url: e.url,
        title: e.title,
        hasBeenRead: e.hasBeenRead,
        creationTime: e.creationTime,
        lastUpdateTime: e.lastUpdateTime,
      }));
    } catch (err) {
      return {
        error: `Failed to query reading list: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
