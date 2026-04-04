/**
 * Clipboard Write Tool
 *
 * Writes text to the system clipboard.
 * Note: In a service worker context, navigator.clipboard may not be available.
 * This tool works best when called from a context with clipboard access.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const clipboardWrite = tool({
  description:
    'Write text to the system clipboard. Note: clipboard access may be limited in some contexts.',
  inputSchema: z.object({
    text: z.string().describe('The text to copy to the clipboard'),
  }),
  execute: async ({ text }) => {
    try {
      await navigator.clipboard.writeText(text);
      return { copied: true };
    } catch (err) {
      return {
        copied: false,
        error: `Failed to write to clipboard: ${err instanceof Error ? err.message : String(err)}. Clipboard access may not be available in the service worker context.`,
      };
    }
  },
});
