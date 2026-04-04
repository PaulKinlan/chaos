/**
 * Bookmark List Tool
 *
 * Lists bookmarks in the agent's dedicated bookmark folder.
 */

import { tool } from 'ai';
import { z } from 'zod';

export function createBookmarkList(agentId: string) {
  return tool({
    description:
      "List all bookmarks in this agent's dedicated bookmark folder.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const folderTitle = `CHAOS: ${agentId}`;
        const results = await chrome.bookmarks.search({ title: folderTitle });
        const folder = results.find((b) => b.url === undefined);

        if (!folder) {
          return [];
        }

        const children = await chrome.bookmarks.getChildren(folder.id);
        return children
          .filter((b) => b.url)
          .map((b) => ({
            title: b.title,
            url: b.url!,
            dateAdded: b.dateAdded ? new Date(b.dateAdded).toISOString() : undefined,
          }));
      } catch (err) {
        return {
          error: `Failed to list bookmarks: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
