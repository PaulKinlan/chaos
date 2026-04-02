/**
 * Fetch Page Tool
 *
 * Fetches a URL using the browser's fetch API, parses the HTML,
 * extracts main content, and returns it as markdown using Turndown.
 */

import { tool } from 'ai';
import { z } from 'zod';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export const fetchPage = tool({
  description:
    'Fetch a web page by URL and return its main content as markdown. Handles CORS errors, 404s, and timeouts gracefully.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch'),
  }),
  execute: async ({ url }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          title: '',
          content: '',
          url,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const html = await response.text();

      // Parse HTML with DOMParser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract title
      const title = doc.querySelector('title')?.textContent?.trim() ?? '';

      // Remove script, style, nav, footer, header elements for cleaner content
      const removeSelectors = ['script', 'style', 'nav', 'footer', 'noscript', 'svg', 'iframe'];
      for (const sel of removeSelectors) {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      }

      // Try to find main content area
      const mainContent =
        doc.querySelector('main') ??
        doc.querySelector('article') ??
        doc.querySelector('[role="main"]') ??
        doc.querySelector('.content') ??
        doc.querySelector('#content') ??
        doc.body;

      // Convert to markdown
      const markdown = turndown.turndown(mainContent?.innerHTML ?? '');

      // Truncate very long content
      const maxLength = 12000;
      const content =
        markdown.length > maxLength
          ? markdown.slice(0, maxLength) + '\n\n[Content truncated]'
          : markdown;

      return { title, content, url };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { title: '', content: '', url, error: 'Request timed out after 15 seconds' };
      }

      const message = err instanceof Error ? err.message : String(err);

      // Detect likely CORS errors
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        return {
          title: '',
          content: '',
          url,
          error: `Network/CORS error fetching ${url}. Try using tab_open + tab_read instead.`,
        };
      }

      return { title: '', content: '', url, error: `Fetch error: ${message}` };
    }
  },
});
