/**
 * Content Script — Page Content Extractor
 *
 * Injected into all pages at document_idle. Listens for 'extractContent'
 * messages from the background service worker and returns extracted
 * page content as markdown.
 *
 * Uses @mozilla/readability as primary parser, falling back to CSS
 * selector-based extraction. Converts HTML to markdown via Turndown.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// ── Turndown instance ──

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// ── Extraction result type ──

interface ExtractedContent {
  title: string;
  url: string;
  content: string;
  excerpt: string;
}

// ── CSS selector fallback ──

const FALLBACK_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.content',
  '#content',
  '#main',
];

function extractFallback(doc: Document): string {
  for (const selector of FALLBACK_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 100) {
      return el.innerHTML;
    }
  }
  // Last resort: use body
  return doc.body.innerHTML;
}

// ── Main extraction function ──

function extractContent(): ExtractedContent {
  const title = document.title || '';
  const url = document.location.href;

  // Try Readability first
  try {
    // Readability modifies the DOM, so clone it
    const docClone = document.cloneNode(true) as Document;
    const reader = new Readability(docClone);
    const article = reader.parse();

    if (article && article.content) {
      const markdown = turndown.turndown(article.content);
      return {
        title: article.title || title,
        url,
        content: markdown,
        excerpt: article.excerpt || markdown.slice(0, 200),
      };
    }
  } catch {
    // Readability failed, fall through to CSS fallback
  }

  // CSS selector fallback
  const html = extractFallback(document);
  const markdown = turndown.turndown(html);
  return {
    title,
    url,
    content: markdown,
    excerpt: markdown.slice(0, 200),
  };
}

// ── Message listener ──

chrome.runtime.onMessage.addListener(
  (
    message: { type: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtractedContent) => void,
  ) => {
    if (message.type === 'extractContent') {
      try {
        const result = extractContent();
        sendResponse(result);
      } catch (err) {
        sendResponse({
          title: document.title || '',
          url: document.location.href,
          content: '',
          excerpt: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return true; // keep the message channel open for async response
    }
  },
);
