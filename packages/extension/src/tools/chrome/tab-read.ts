/**
 * Tab Read Tool
 *
 * Reads the active tab's content via content script extraction.
 * Uses a three-tier approach:
 * 1. Send message to already-injected content script (Readability + Turndown)
 * 2. Inject content script via chrome.scripting.executeScript, then message it
 * 3. Fall back to inline innerText extraction as last resort
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

    // Tier 1: Try messaging the already-injected content script
    try {
      const response = await chrome.tabs.sendMessage(targetTabId, {
        type: 'extractContent',
      }) as { title: string; url: string; content: string; excerpt: string } | undefined;

      if (response?.content) {
        return response;
      }
    } catch {
      // Content script not present — try tier 2
    }

    // Tier 2: Inject content script file, then message it
    try {
      const hasScripting = await chrome.permissions.contains({
        permissions: ['scripting'],
        origins: ['<all_urls>'],
      });

      if (hasScripting) {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          files: ['src/content/extractor.js'],
        });

        // Brief delay for script to initialise listener
        await new Promise((r) => setTimeout(r, 200));

        const response = await chrome.tabs.sendMessage(targetTabId, {
          type: 'extractContent',
        }) as { title: string; url: string; content: string; excerpt: string } | undefined;

        if (response?.content) {
          return response;
        }
      }
    } catch {
      // Injection failed — try tier 3
    }

    // Tier 3: Inline innerText fallback (works without content script file)
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => {
          const title = document.title || '';
          const url = location.href || '';
          const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content', '.content', '#content'];
          let contentEl: Element | null = null;
          for (const sel of selectors) {
            contentEl = document.querySelector(sel);
            if (contentEl) break;
          }
          const rawText = ((contentEl || document.body) as HTMLElement)?.innerText || '';
          const content = rawText.slice(0, 8000);
          const excerpt = rawText.slice(0, 200);
          return { title, url, content, excerpt };
        },
      });

      const result = results?.[0]?.result as { title: string; url: string; content: string; excerpt: string } | undefined;
      if (result) {
        return result;
      }
    } catch {
      // Can't inject into this page at all
    }

    // Last resort: return basic tab info
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.id === targetTabId);
    return {
      title: tab?.title ?? '',
      url: tab?.url ?? '',
      content: '',
      excerpt: 'Could not extract page content. Try using fetch_page with the URL instead.',
    };
  },
});
