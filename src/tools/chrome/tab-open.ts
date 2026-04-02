/**
 * Tab Open Tool
 *
 * Opens a URL in a new browser tab.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabOpen = tool({
  description:
    'Open a URL in a new browser tab. By default the tab opens in the background.',
  inputSchema: z.object({
    url: z.string().describe('The URL to open'),
    active: z
      .boolean()
      .default(false)
      .describe('Whether to make the new tab active (default: false, opens in background)'),
  }),
  execute: async ({ url, active }) => {
    try {
      const tab = await chrome.tabs.create({ url, active });
      return { tabId: tab.id!, url: tab.pendingUrl ?? url };
    } catch (err) {
      return {
        tabId: -1,
        url,
        error: `Failed to open tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
