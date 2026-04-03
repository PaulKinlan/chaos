/**
 * Fetch Page Tool
 *
 * Fetches a URL and extracts content as markdown.
 * Uses an offscreen document with Readability + Turndown for proper DOM parsing.
 * Falls back to regex-based extraction if offscreen is unavailable.
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Ensure the offscreen parser document exists.
 * Returns true if available, false if offscreen API is not supported.
 */
async function ensureOffscreenParser(): Promise<boolean> {
  try {
    // Check if offscreen API is available
    if (!chrome.offscreen) return false;

    // Check if document already exists
    const contexts = await (chrome.runtime as unknown as {
      getContexts(filter: { contextTypes: string[] }): Promise<{ documentUrl: string }[]>;
    }).getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

    if (contexts && contexts.length > 0) return true;

    // Create the offscreen document
    await chrome.offscreen.createDocument({
      url: 'src/offscreen-parser.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Parse HTML content with DOMParser and Readability',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse HTML using the offscreen document (Readability + Turndown).
 */
async function parseWithOffscreen(html: string, url: string): Promise<{ title: string; content: string } | null> {
  try {
    const available = await ensureOffscreenParser();
    if (!available) return null;

    const response = await chrome.runtime.sendMessage({
      type: 'parseHtml',
      html,
      url,
    }) as { title: string; content: string } | undefined;

    if (response?.content) {
      return response;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags and decode common entities.
 * Regex fallback for when offscreen document is unavailable.
 */
function htmlToText(html: string): string {
  // Remove script, style, nav, footer, noscript, svg, iframe blocks
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

  // Convert headers to markdown-style
  cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  cleaned = cleaned.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n');

  // Convert paragraphs and divs to double newlines
  cleaned = cleaned.replace(/<\/p>/gi, '\n\n');
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
  cleaned = cleaned.replace(/<\/div>/gi, '\n');
  cleaned = cleaned.replace(/<li[^>]*>/gi, '\n- ');

  // Convert links
  cleaned = cleaned.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Try to extract main content from HTML using regex (fallback).
 */
function extractMainContent(html: string): string {
  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = html.match(pattern);
    if (match && match[1] && match[1].length > 200) {
      return htmlToText(match[1]);
    }
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return htmlToText(bodyMatch[1]);
  }

  return htmlToText(html);
}

export const fetchPage = tool({
  description:
    'Fetch a web page by URL and return its main content as markdown. Uses Readability for article extraction when available. Handles CORS errors, 404s, and timeouts gracefully.',
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

      // Try offscreen document parsing first (Readability + Turndown)
      const offscreenResult = await parseWithOffscreen(html, url);
      if (offscreenResult) {
        return {
          title: offscreenResult.title,
          content: offscreenResult.content,
          url,
        };
      }

      // Fallback: regex-based extraction
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';

      const rawContent = extractMainContent(html);

      const maxLength = 12000;
      const content =
        rawContent.length > maxLength
          ? rawContent.slice(0, maxLength) + '\n\n[Content truncated]'
          : rawContent;

      return { title, content, url };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { title: '', content: '', url, error: 'Request timed out after 15 seconds' };
      }

      const message = err instanceof Error ? err.message : String(err);

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
