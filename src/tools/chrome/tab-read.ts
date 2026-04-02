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
  inputSchema: z.object({
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
      // Try sending message first (content script may already be injected)
      let response: Record<string, string>;
      try {
        response = await chrome.tabs.sendMessage(targetTabId, {
          type: 'extractContent',
        });
      } catch {
        // Content script not injected yet - inject dynamically
        try {
          await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            files: ['src/content/extractor.ts'],
          });
          // Wait for script to initialize
          await new Promise((r) => setTimeout(r, 300));
          response = await chrome.tabs.sendMessage(targetTabId, {
            type: 'extractContent',
          });
        } catch (injectErr) {
          // Last resort: try to get basic info from the tab
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find((t) => t.id === targetTabId);
          return {
            title: tab?.title ?? '',
            url: tab?.url ?? '',
            content: '',
            excerpt: `Could not read page content: ${injectErr instanceof Error ? injectErr.message : String(injectErr)}. The page may not allow content scripts (e.g. chrome:// pages). Try using fetch_page with the URL instead.`,
          };
        }
      }
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
        excerpt: `Error: Could not extract content from tab ${targetTabId}: ${err instanceof Error ? err.message : String(err)}. Try using fetch_page with the URL instead.`,
      };
    }
  },
});
