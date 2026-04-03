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
      // Use chrome.scripting.executeScript with an inline function
      // This avoids content script file path issues and works reliably
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => {
          // Extract page content directly in the tab context
          const title = document.title || '';
          const url = location.href || '';

          // Try to get main content
          const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content', '.content', '#content'];
          let contentEl: Element | null = null;
          for (const sel of selectors) {
            contentEl = document.querySelector(sel);
            if (contentEl) break;
          }

          const rawText = ((contentEl || document.body) as HTMLElement)?.innerText || '';
          // Truncate to ~8000 chars to avoid huge payloads
          const content = rawText.slice(0, 8000);
          const excerpt = rawText.slice(0, 200);

          return { title, url, content, excerpt };
        },
      });

      const result = results?.[0]?.result as { title: string; url: string; content: string; excerpt: string } | undefined;
      if (result) {
        return result;
      }

      // Fallback to basic tab info
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.id === targetTabId);
      return {
        title: tab?.title ?? '',
        url: tab?.url ?? '',
        content: '',
        excerpt: 'Could not extract page content. Try using fetch_page with the URL instead.',
      };
    } catch (err) {
      // Can't inject into this page (chrome://, etc.)
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.id === targetTabId);
      return {
        title: tab?.title ?? '',
        url: tab?.url ?? '',
        content: '',
        excerpt: `Could not read page: ${err instanceof Error ? err.message : String(err)}. Try using fetch_page with the URL instead.`,
      };
    }
  },
});
