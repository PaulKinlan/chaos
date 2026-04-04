/**
 * Window Create Tool
 *
 * Creates a new browser window.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const windowCreate = tool({
  description:
    'Create a new browser window. Optionally open a URL, set size, or create an incognito/popup window.',
  inputSchema: z.object({
    url: z.string().optional().describe('URL to open in the new window'),
    type: z
      .enum(['normal', 'popup', 'panel'])
      .optional()
      .describe('Window type (default: normal)'),
    width: z.number().optional().describe('Window width in pixels'),
    height: z.number().optional().describe('Window height in pixels'),
    focused: z.boolean().optional().describe('Whether to focus the new window (default: true)'),
    incognito: z.boolean().optional().describe('Whether to create an incognito window'),
  }),
  execute: async ({ url, type, width, height, focused, incognito }) => {
    try {
      const createData: chrome.windows.CreateData = {};
      if (url !== undefined) createData.url = url;
      if (type !== undefined) createData.type = type;
      if (width !== undefined) createData.width = width;
      if (height !== undefined) createData.height = height;
      if (focused !== undefined) createData.focused = focused;
      if (incognito !== undefined) createData.incognito = incognito;

      const window = await chrome.windows.create(createData);
      return {
        windowId: window.id,
        type: window.type,
        focused: window.focused,
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
        error: `Failed to create window: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
