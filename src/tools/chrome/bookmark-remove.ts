/**
 * Bookmark Remove Tool
 *
 * Removes a bookmark by its ID.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const bookmarkRemove = tool({
  description: 'Remove a bookmark by its ID.',
  parameters: z.object({
    bookmarkId: z.string().describe('The ID of the bookmark to remove'),
  }),
  execute: async ({ bookmarkId }) => {
    try {
      await chrome.bookmarks.remove(bookmarkId);
      return { removed: true, bookmarkId };
    } catch (err) {
      return {
        removed: false,
        bookmarkId,
        error: `Failed to remove bookmark: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
