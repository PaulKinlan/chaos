/**
 * Bookmark Add Tool
 *
 * Adds a bookmark to the agent's dedicated bookmark folder.
 * Creates the agent's folder if it doesn't exist.
 */

import { tool } from 'ai';
import { z } from 'zod';

async function findOrCreateAgentFolder(agentId: string): Promise<string> {
  const folderTitle = `CHAOS: ${agentId}`;

  // Search for existing folder
  const results = await chrome.bookmarks.search({ title: folderTitle });
  const folder = results.find(
    (b) => b.url === undefined, // folders have no url
  );
  if (folder) {
    return folder.id;
  }

  // Create the folder under "Other Bookmarks" (id "2")
  const newFolder = await chrome.bookmarks.create({
    parentId: '2',
    title: folderTitle,
  });
  return newFolder.id;
}

export function createBookmarkAdd(agentId: string) {
  return tool({
    description:
      "Add a bookmark to this agent's dedicated bookmark folder. Creates the folder if it doesn't exist.",
    parameters: z.object({
      url: z.string().describe('URL to bookmark'),
      title: z.string().describe('Title for the bookmark'),
    }),
    execute: async ({ url, title }) => {
      try {
        const folderId = await findOrCreateAgentFolder(agentId);
        const bookmark = await chrome.bookmarks.create({
          parentId: folderId,
          title,
          url,
        });
        return { id: bookmark.id, title, url, folderId };
      } catch (err) {
        return {
          error: `Failed to add bookmark: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
