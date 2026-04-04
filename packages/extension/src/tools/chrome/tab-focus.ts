/**
 * Tab Focus Tool
 *
 * Focuses/activates an existing tab and brings its window to the front.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabFocus = tool({
  description:
    'Focus an existing browser tab by its ID, making it the active tab and bringing its window to the front.',
  inputSchema: z.object({
    tabId: z.number().describe('The ID of the tab to focus'),
  }),
  execute: async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { focused: true, tabId, windowId: tab?.windowId };
    } catch (err) {
      return {
        focused: false,
        tabId,
        error: `Failed to focus tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
