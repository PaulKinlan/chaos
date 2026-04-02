/**
 * Tab Move Tool
 *
 * Moves a tab to a different window or position.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabMove = tool({
  description:
    'Move a tab to a different position or window. Specify a target window and/or index.',
  parameters: z.object({
    tabId: z.number().describe('The ID of the tab to move'),
    windowId: z.number().optional().describe('The ID of the target window'),
    index: z
      .number()
      .default(-1)
      .describe('The position to move the tab to (-1 for end, default: -1)'),
  }),
  execute: async ({ tabId, windowId, index }) => {
    try {
      const moveProperties: chrome.tabs.MoveProperties = { index };
      if (windowId !== undefined) moveProperties.windowId = windowId;

      const tab = await chrome.tabs.move(tabId, moveProperties);
      const moved = Array.isArray(tab) ? tab[0] : tab;
      return {
        success: true,
        tabId: moved.id,
        windowId: moved.windowId,
        index: moved.index,
      };
    } catch (err) {
      return {
        success: false,
        tabId,
        error: `Failed to move tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
