/**
 * Tab Screenshot Tool
 *
 * Captures a screenshot of the currently visible tab.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabScreenshot = tool({
  description:
    'Capture a screenshot of the currently active tab. Returns a base64-encoded PNG data URL.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined as unknown as number, {
        format: 'png',
      });
      return { dataUrl };
    } catch (err) {
      return {
        dataUrl: null,
        error: `Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
