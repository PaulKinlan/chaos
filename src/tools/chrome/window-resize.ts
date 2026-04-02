/**
 * Window Resize Tool
 *
 * Resizes, moves, or changes the state of a browser window.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const windowResize = tool({
  description:
    'Resize, move, or change the state of a browser window (minimize, maximize, fullscreen).',
  parameters: z.object({
    windowId: z.number().describe('The ID of the window to resize/move'),
    width: z.number().optional().describe('New width in pixels'),
    height: z.number().optional().describe('New height in pixels'),
    left: z.number().optional().describe('New left position in pixels'),
    top: z.number().optional().describe('New top position in pixels'),
    state: z
      .enum(['normal', 'minimized', 'maximized', 'fullscreen'])
      .optional()
      .describe('New window state'),
  }),
  execute: async ({ windowId, width, height, left, top, state }) => {
    try {
      const updateInfo: chrome.windows.UpdateInfo = {};
      if (width !== undefined) updateInfo.width = width;
      if (height !== undefined) updateInfo.height = height;
      if (left !== undefined) updateInfo.left = left;
      if (top !== undefined) updateInfo.top = top;
      if (state !== undefined) updateInfo.state = state;

      const window = await chrome.windows.update(windowId, updateInfo);
      return {
        success: true,
        windowId: window.id,
        state: window.state,
        bounds: {
          left: window.left,
          top: window.top,
          width: window.width,
          height: window.height,
        },
      };
    } catch (err) {
      return {
        success: false,
        windowId,
        error: `Failed to resize window: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
