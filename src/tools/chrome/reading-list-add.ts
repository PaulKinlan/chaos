/**
 * Reading List Add Tool
 *
 * Adds a URL to the Chrome reading list.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const readingListAdd = tool({
  description: 'Add a URL to the browser reading list with a title.',
  inputSchema: z.object({
    url: z.string().describe('The URL to add to the reading list'),
    title: z.string().describe('Title for the reading list entry'),
  }),
  execute: async ({ url, title }) => {
    try {
      await chrome.readingList.addEntry({ url, title, hasBeenRead: false });
      return { success: true, url, title };
    } catch (err) {
      return {
        success: false,
        url,
        error: `Failed to add to reading list: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
