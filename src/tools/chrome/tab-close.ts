/**
 * Tab Close Tool
 *
 * Closes a browser tab by its ID.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabClose = tool({
  description: 'Close a browser tab by its ID.',
  parameters: z.object({
    tabId: z.number().describe('The ID of the tab to close'),
  }),
  execute: async ({ tabId }) => {
    try {
      await chrome.tabs.remove(tabId);
      return { success: true, tabId };
    } catch (err) {
      return {
        success: false,
        tabId,
        error: `Failed to close tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
