/**
 * Tab Mute Tool
 *
 * Mutes or unmutes a browser tab.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabMute = tool({
  description: 'Mute or unmute a browser tab by its ID.',
  parameters: z.object({
    tabId: z.number().describe('The ID of the tab to mute/unmute'),
    muted: z.boolean().describe('Whether to mute (true) or unmute (false) the tab'),
  }),
  execute: async ({ tabId, muted }) => {
    try {
      const tab = await chrome.tabs.update(tabId, { muted });
      return { success: true, tabId: tab?.id, muted: tab?.mutedInfo?.muted };
    } catch (err) {
      return {
        success: false,
        tabId,
        error: `Failed to ${muted ? 'mute' : 'unmute'} tab: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
