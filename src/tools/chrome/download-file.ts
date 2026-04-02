/**
 * Download File Tool
 *
 * Downloads a file from a URL using the Chrome downloads API.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const downloadFile = tool({
  description: 'Download a file from a URL. Optionally specify a filename for the download.',
  parameters: z.object({
    url: z.string().describe('The URL of the file to download'),
    filename: z.string().optional().describe('Suggested filename for the download'),
  }),
  execute: async ({ url, filename }) => {
    try {
      const options: chrome.downloads.DownloadOptions = { url };
      if (filename !== undefined) options.filename = filename;

      const downloadId = await chrome.downloads.download(options);
      return { success: true, downloadId, url, filename };
    } catch (err) {
      return {
        success: false,
        url,
        error: `Failed to download file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
