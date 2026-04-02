/**
 * Tab Duplicate Tool
 *
 * Duplicates an existing browser tab.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabDuplicate = tool({
  description: 'Duplicate an existing browser tab by its ID.',
  inputSchema: z.object({
    tabId: z.number().describe('The ID of the tab to duplicate'),
  }),
  execute: async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.duplicate(tabId);
      return { success: true, newTabId: tab?.id, url: tab?.url ?? tab?.pendingUrl };
    } catch (err) {
      return {
        success: false,
        tabId,
        error: `Failed to duplicate tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
