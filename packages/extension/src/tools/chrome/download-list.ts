/**
 * Download List Tool
 *
 * Searches recent downloads using the Chrome downloads API.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const downloadList = tool({
  description: 'Search recent downloads. Optionally filter by query string and limit results.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query to filter downloads by filename or URL'),
    limit: z
      .number()
      .default(20)
      .describe('Maximum number of results to return (default: 20)'),
  }),
  execute: async ({ query, limit }) => {
    try {
      const searchOptions: chrome.downloads.DownloadQuery = {
        limit,
        orderBy: ['-startTime'],
      };
      if (query !== undefined) searchOptions.query = [query];

      const results = await chrome.downloads.search(searchOptions);
      return results.map((d) => ({
        id: d.id,
        filename: d.filename,
        url: d.url,
        state: d.state,
        fileSize: d.fileSize,
        startTime: d.startTime,
        endTime: d.endTime,
        mime: d.mime,
      }));
    } catch (err) {
      return {
        error: `Failed to search downloads: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
