/**
 * Offscreen Document — HTML Parser
 *
 * Receives raw HTML via chrome.runtime.onMessage, parses it with DOMParser,
 * extracts main content via Readability, and converts to markdown via Turndown.
 * Used by fetch_page to get real DOM parsing in the service worker context.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Strip noise elements
const NOISE_TAGS = new Set(['style', 'script', 'noscript', 'iframe', 'head', 'nav', 'footer', 'header', 'aside', 'form', 'input', 'button', 'select', 'textarea', 'svg']);
turndown.addRule('remove-noise', {
  filter: (node) => NOISE_TAGS.has(node.nodeName.toLowerCase()),
  replacement: () => '',
});

// Keep link text but remove the link itself
turndown.addRule('flatten-links', {
  filter: ['a'],
  replacement: (content) => content,
});

// Remove images
turndown.addRule('remove-images', {
  filter: ['img'],
  replacement: () => '',
});

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; html: string; url?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { title: string; content: string }) => void,
  ) => {
    if (message.type !== 'parseHtml') return;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(message.html, 'text/html');

      // Set the base URL so Readability can resolve relative links
      if (message.url) {
        const base = doc.createElement('base');
        base.href = message.url;
        doc.head.appendChild(base);
      }

      let title = '';
      let content = '';

      // Try Readability
      try {
        const docClone = doc.cloneNode(true) as Document;
        const reader = new Readability(docClone);
        const article = reader.parse();

        if (article && article.content) {
          title = article.title || doc.title || '';
          content = turndown.turndown(article.content);
        }
      } catch {
        // Readability failed, fall through
      }

      // Fallback: extract from body
      if (!content) {
        title = doc.title || '';
        // Try main content selectors first
        const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content', '.content', '#content'];
        let html = '';
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 100) {
            html = el.innerHTML;
            break;
          }
        }
        if (!html) {
          html = doc.body?.innerHTML || '';
        }
        content = turndown.turndown(html);
      }

      // Truncate to 12000 chars
      sendResponse({
        title,
        content: content.slice(0, 12000),
      });
    } catch (err) {
      sendResponse({
        title: '',
        content: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return true; // async response
  },
);
