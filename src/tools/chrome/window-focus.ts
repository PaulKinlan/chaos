/**
 * Window Focus Tool
 *
 * Focuses a browser window by its ID.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const windowFocus = tool({
  description: 'Focus a browser window by its ID, bringing it to the front.',
  parameters: z.object({
    windowId: z.number().describe('The ID of the window to focus'),
  }),
  execute: async ({ windowId }) => {
    try {
      const window = await chrome.windows.update(windowId, { focused: true });
      return { success: true, windowId: window.id, focused: window.focused };
    } catch (err) {
      return {
        success: false,
        windowId,
        error: `Failed to focus window: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
