/**
 * Tab Pin Tool
 *
 * Pins or unpins a browser tab.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabPin = tool({
  description: 'Pin or unpin a browser tab by its ID.',
  inputSchema: z.object({
    tabId: z.number().describe('The ID of the tab to pin/unpin'),
    pinned: z.boolean().describe('Whether to pin (true) or unpin (false) the tab'),
  }),
  execute: async ({ tabId, pinned }) => {
    try {
      const tab = await chrome.tabs.update(tabId, { pinned });
      return { success: true, tabId: tab?.id, pinned: tab?.pinned };
    } catch (err) {
      return {
        success: false,
        tabId,
        error: `Failed to ${pinned ? 'pin' : 'unpin'} tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
