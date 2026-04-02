/**
 * Window Close Tool
 *
 * Closes a browser window by its ID.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const windowClose = tool({
  description: 'Close a browser window by its ID.',
  inputSchema: z.object({
    windowId: z.number().describe('The ID of the window to close'),
  }),
  execute: async ({ windowId }) => {
    try {
      await chrome.windows.remove(windowId);
      return { success: true, windowId };
    } catch (err) {
      return {
        success: false,
        windowId,
        error: `Failed to close window: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
