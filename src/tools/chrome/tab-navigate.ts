/**
 * Tab Navigate Tool
 *
 * Navigates an existing tab to a new URL.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabNavigate = tool({
  description:
    'Navigate an existing browser tab to a new URL. Unlike tab_open, this reuses an existing tab instead of opening a new one.',
  parameters: z.object({
    tabId: z.number().describe('The ID of the tab to navigate'),
    url: z.string().describe('The URL to navigate to'),
  }),
  execute: async ({ tabId, url }) => {
    try {
      const tab = await chrome.tabs.update(tabId, { url });
      return { tabId, url: tab?.pendingUrl ?? url, navigated: true };
    } catch (err) {
      return {
        tabId,
        url,
        navigated: false,
        error: `Failed to navigate tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
