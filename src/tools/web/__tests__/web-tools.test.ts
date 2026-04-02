/**
 * Web Tools Tests
 *
 * Tests for fetch_page and web_search tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DOMParser for Node environment ──

class MockElement {
  tagName: string;
  textContent: string;
  innerHTML: string;
  children: MockElement[] = [];
  parentNode: MockElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
    this.textContent = '';
    this.innerHTML = '';
  }

  querySelector(selector: string): MockElement | null {
    // Simple selector matching for test purposes
    const tag = selector.replace(/[[\]'"=a-z-]/g, '').toLowerCase() || selector.toLowerCase();
    if (this.tagName.toLowerCase() === tag) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.tagName.toLowerCase() === selector.toLowerCase()) results.push(this);
    for (const child of this.children) {
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    }
  }

  forEach?: (fn: (el: MockElement) => void) => void;
}

// Extend Array-like return from querySelectorAll
const origQuerySelectorAll = MockElement.prototype.querySelectorAll;
MockElement.prototype.querySelectorAll = function (selector: string) {
  const results = origQuerySelectorAll.call(this, selector);
  (results as unknown as { forEach: typeof Array.prototype.forEach }).forEach =
    Array.prototype.forEach;
  return results;
};

class MockDOMParser {
  parseFromString(html: string, _type: string) {
    // Very simple HTML parser for test purposes
    const doc = new MockElement('document');

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const titleEl = new MockElement('title');
    titleEl.textContent = titleMatch?.[1]?.trim() ?? '';

    const body = new MockElement('body');
    body.innerHTML = html;
    body.parentNode = doc;

    // Parse main/article/nav/footer elements
    const mainMatch = html.match(/<main>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      const main = new MockElement('main');
      main.innerHTML = mainMatch[1];
      main.textContent = mainMatch[1].replace(/<[^>]+>/g, '').trim();
      main.parentNode = body;
      body.children.push(main);
    }

    const navMatch = html.match(/<nav>([\s\S]*?)<\/nav>/i);
    if (navMatch) {
      const nav = new MockElement('nav');
      nav.textContent = navMatch[1].replace(/<[^>]+>/g, '').trim();
      nav.parentNode = body;
      body.children.push(nav);
    }

    const footerMatch = html.match(/<footer>([\s\S]*?)<\/footer>/i);
    if (footerMatch) {
      const footer = new MockElement('footer');
      footer.textContent = footerMatch[1].replace(/<[^>]+>/g, '').trim();
      footer.parentNode = body;
      body.children.push(footer);
    }

    doc.children.push(body);

    return {
      querySelector: (sel: string) => {
        if (sel === 'title') return titleEl;
        if (sel === 'main') return mainMatch ? body.children.find((c) => c.tagName === 'main') : null;
        if (sel === 'article') return null;
        if (sel === '[role="main"]') return null;
        if (sel === '.content') return null;
        if (sel === '#content') return null;
        if (sel === 'body') return body;
        return body.querySelector(sel);
      },
      querySelectorAll: (sel: string) => {
        const results = body.querySelectorAll(sel);
        return results;
      },
      body,
    };
  }
}

// Install DOMParser globally before tests
if (typeof globalThis.DOMParser === 'undefined') {
  (globalThis as Record<string, unknown>).DOMParser = MockDOMParser;
}

// ── Import after DOMParser mock is installed ──
const { getWebTools } = await import('../index.js');

describe('getWebTools', () => {
  it('returns fetch_page and web_search tools', () => {
    const tools = getWebTools();
    const keys = Object.keys(tools);
    expect(keys).toContain('fetch_page');
    expect(keys).toContain('web_search');
    expect(keys).toHaveLength(2);
  });

  it('accepts optional braveApiKey', () => {
    const tools = getWebTools({ braveApiKey: 'test-key' });
    const keys = Object.keys(tools);
    expect(keys).toContain('fetch_page');
    expect(keys).toContain('web_search');
    expect(keys).toHaveLength(2);
  });
});

describe('fetch_page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and extracts content from a URL', async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav>Navigation</nav>
          <main><h1>Hello World</h1><p>This is content.</p></main>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const tools = getWebTools();
    const result = await tools.fetch_page.execute!(
      { url: 'https://example.com' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { title: string; content: string; url: string };
    expect(r.title).toBe('Test Page');
    expect(r.url).toBe('https://example.com');
    // Content should include main content (Turndown converts HTML to markdown)
    expect(r.content).toBeTruthy();
  });

  it('returns error for non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    const tools = getWebTools();
    const result = await tools.fetch_page.execute!(
      { url: 'https://example.com/missing' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { error: string; url: string };
    expect(r.error).toContain('404');
    expect(r.url).toBe('https://example.com/missing');
  });

  it('handles network/CORS errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const tools = getWebTools();
    const result = await tools.fetch_page.execute!(
      { url: 'https://cors-blocked.com' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { error: string; url: string };
    expect(r.error).toContain('CORS');
    expect(r.url).toBe('https://cors-blocked.com');
  });

  it('handles timeout via AbortError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    const tools = getWebTools();
    const result = await tools.fetch_page.execute!(
      { url: 'https://slow.com' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { error: string; url: string };
    expect(r.error).toContain('timed out');
  });

  it('returns url and empty content on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Something went wrong'));

    const tools = getWebTools();
    const result = await tools.fetch_page.execute!(
      { url: 'https://broken.com' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { error: string; url: string; content: string };
    expect(r.url).toBe('https://broken.com');
    expect(r.error).toContain('Something went wrong');
    expect(r.content).toBe('');
  });
});

describe('web_search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns DuckDuckGo results for a query', async () => {
    const ddgResponse = {
      AbstractText: 'TypeScript is a typed superset of JavaScript.',
      AbstractURL: 'https://www.typescriptlang.org/',
      AbstractSource: 'TypeScript',
      Heading: 'TypeScript',
      RelatedTopics: [
        {
          Text: 'TypeScript Tutorial - Learn TypeScript basics.',
          FirstURL: 'https://example.com/ts-tutorial',
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(ddgResponse), { status: 200 }),
    );

    const tools = getWebTools();
    const result = await tools.web_search.execute!(
      { query: 'TypeScript' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { source: string; query: string; results: Array<{ title: string; url: string; description: string }> };
    expect(r.source).toBe('duckduckgo');
    expect(r.query).toBe('TypeScript');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].title).toBe('TypeScript');
    expect(r.results[0].url).toBe('https://www.typescriptlang.org/');
    expect(r.results[0].description).toContain('typed superset');
  });

  it('returns empty results with message when no results found', async () => {
    const ddgResponse = {
      AbstractText: '',
      RelatedTopics: [],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(ddgResponse), { status: 200 }),
    );

    const tools = getWebTools();
    const result = await tools.web_search.execute!(
      { query: 'xyznonexistentquery123' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { source: string; results: unknown[]; message: string };
    expect(r.source).toBe('none');
    expect(r.results).toHaveLength(0);
    expect(r.message).toContain('No results');
  });

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const tools = getWebTools();
    const result = await tools.web_search.execute!(
      { query: 'test' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { source: string; error: string };
    expect(r.source).toBe('error');
    expect(r.error).toContain('Network error');
  });

  it('uses Brave Search when API key is provided', async () => {
    const braveResponse = {
      web: {
        results: [
          {
            title: 'Brave Result 1',
            url: 'https://brave-result.com',
            description: 'A result from Brave Search.',
          },
        ],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(braveResponse), { status: 200 }),
    );

    const tools = getWebTools({ braveApiKey: 'test-brave-key' });
    const result = await tools.web_search.execute!(
      { query: 'test' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { source: string; results: Array<{ title: string; url: string }> };
    expect(r.source).toBe('brave');
    expect(r.results[0].title).toBe('Brave Result 1');
    expect(r.results[0].url).toBe('https://brave-result.com');
  });

  it('falls back to DuckDuckGo when Brave fails', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      callCount++;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('brave')) {
        return new Response('Unauthorized', { status: 401 });
      }
      // DuckDuckGo response
      return new Response(
        JSON.stringify({
          AbstractText: 'Fallback result',
          AbstractURL: 'https://fallback.com',
          Heading: 'Fallback',
          RelatedTopics: [],
        }),
        { status: 200 },
      );
    });

    const tools = getWebTools({ braveApiKey: 'bad-key' });
    const result = await tools.web_search.execute!(
      { query: 'test' },
      { toolCallId: 'test', messages: [] },
    );

    const r = result as { source: string; results: Array<{ title: string }> };
    expect(r.source).toBe('duckduckgo');
    expect(r.results[0].title).toBe('Fallback');
    expect(callCount).toBe(2); // Brave failed, then DuckDuckGo
  });

  it('URL-encodes the query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ AbstractText: '', RelatedTopics: [] }), { status: 200 }),
    );

    const tools = getWebTools();
    await tools.web_search.execute!(
      { query: 'hello world & stuff' },
      { toolCallId: 'test', messages: [] },
    );

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('hello%20world');
    expect(calledUrl).not.toContain('&stuff');
  });
});
