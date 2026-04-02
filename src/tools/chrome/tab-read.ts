/**
 * Tab Read Tool
 *
 * Reads the active tab's content via content script extraction.
 * Sends an 'extractContent' message to the tab's content script
 * and returns the extracted title, URL, content, and excerpt.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabRead = tool({
  description:
    'Read the content of a browser tab by extracting its page content as markdown. Defaults to the active tab if no tabId is provided.',
  parameters: z.object({
    tabId: z
      .number()
      .optional()
      .describe('Tab ID to read. Defaults to the active tab.'),
  }),
  execute: async ({ tabId }) => {
    let targetTabId = tabId;

    if (targetTabId === undefined) {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        return { title: '', url: '', content: '', excerpt: 'Error: No active tab found' };
      }
      targetTabId = activeTab.id;
    }

    try {
      const response = await chrome.tabs.sendMessage(targetTabId, {
        type: 'extractContent',
      });
      return {
        title: response.title ?? '',
        url: response.url ?? '',
        content: response.content ?? '',
        excerpt: response.excerpt ?? '',
      };
    } catch (err) {
      return {
        title: '',
        url: '',
        content: '',
        excerpt: `Error: Could not extract content from tab ${targetTabId}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
