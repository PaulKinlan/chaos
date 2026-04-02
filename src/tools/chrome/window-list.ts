/**
 * Window List Tool
 *
 * Lists all open browser windows.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const windowList = tool({
  description: 'List all open browser windows with their IDs, types, and bounds.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const windows = await chrome.windows.getAll({ populate: false });
      return windows.map((w) => ({
        windowId: w.id,
        type: w.type,
        focused: w.focused,
        state: w.state,
        bounds: {
          left: w.left,
          top: w.top,
          width: w.width,
          height: w.height,
        },
      }));
    } catch (err) {
      return {
        error: `Failed to list windows: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
