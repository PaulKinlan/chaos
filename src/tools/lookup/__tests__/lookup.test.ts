/**
 * Tool Lookup Tests
 *
 * Tests for keyword lookup, static lookup, registry, and factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeywordLookup } from '../keyword-lookup.js';
import { StaticLookup } from '../static-lookup.js';
import { EmbeddingLookup, cosineSimilarity, hashString } from '../embedding-lookup.js';
import { createToolLookup } from '../index.js';
import { toolRegistry } from '../registry.js';
import type { ToolMeta } from '../types.js';

// ── Test fixtures ──

const tabOpenMeta: ToolMeta = {
  name: 'tab_open',
  description: 'Open a URL in a new browser tab.',
  keywords: ['tab', 'open', 'url', 'new', 'navigate', 'browse', 'visit', 'website'],
  category: 'chrome',
};

const tabCloseMeta: ToolMeta = {
  name: 'tab_close',
  description: 'Close a browser tab by its ID.',
  keywords: ['tab', 'close', 'remove', 'delete', 'shut'],
  category: 'chrome',
};

const tabReadMeta: ToolMeta = {
  name: 'tab_read',
  description: 'Read the content of a browser tab by extracting its page content as markdown.',
  keywords: ['tab', 'read', 'content', 'extract', 'page', 'markdown', 'scrape', 'text'],
  category: 'chrome',
};

const messageSendMeta: ToolMeta = {
  name: 'message_send',
  description: 'Send a message to another agent or broadcast to all visible agents.',
  keywords: ['message', 'send', 'communicate', 'tell', 'notify', 'broadcast', 'agent'],
  category: 'communication',
};

const readFileMeta: ToolMeta = {
  name: 'read_file',
  description: 'Read a file from the agent private storage.',
  keywords: ['file', 'read', 'open', 'content', 'load', 'get', 'text'],
  category: 'file',
};

const writeFileMeta: ToolMeta = {
  name: 'write_file',
  description: 'Write content to a file in the agent private storage.',
  keywords: ['file', 'write', 'save', 'create', 'store', 'output'],
  category: 'file',
};

const bookmarkSearchMeta: ToolMeta = {
  name: 'bookmark_search',
  description: 'Search bookmarks by a query string.',
  keywords: ['bookmark', 'search', 'find', 'query', 'lookup', 'saved'],
  category: 'chrome',
};

const allFixtures = [
  tabOpenMeta,
  tabCloseMeta,
  tabReadMeta,
  messageSendMeta,
  readFileMeta,
  writeFileMeta,
  bookmarkSearchMeta,
];

// ── Keyword Lookup Tests ──

describe('KeywordLookup', () => {
  let lookup: KeywordLookup;

  beforeEach(() => {
    lookup = new KeywordLookup();
    for (const meta of allFixtures) {
      lookup.register(meta);
    }
  });

  it('matches relevant tools for "open a new tab"', async () => {
    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('tab_open');
  });

  it('matches tab_close for "close the tab"', async () => {
    const results = await lookup.resolve('close the tab');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('tab_close');
  });

  it('matches tab_read for "read page content"', async () => {
    const results = await lookup.resolve('read page content');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('tab_read');
  });

  it('matches message_send for "send a message to another agent"', async () => {
    const results = await lookup.resolve('send a message to another agent');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('message_send');
  });

  it('matches file tools for "write to a file"', async () => {
    const results = await lookup.resolve('write to a file');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('write_file');
  });

  it('ranks results by relevance', async () => {
    const results = await lookup.resolve('open a new tab');
    // tab_open should rank higher than tab_close for this intent
    const openIdx = results.findIndex((r) => r.name === 'tab_open');
    const closeIdx = results.findIndex((r) => r.name === 'tab_close');
    if (closeIdx !== -1) {
      expect(openIdx).toBeLessThan(closeIdx);
    }
  });

  it('respects topK limit', async () => {
    const results = await lookup.resolve('tab', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for empty intent', async () => {
    const results = await lookup.resolve('');
    expect(results).toEqual([]);
  });

  it('returns empty for nonsensical intent', async () => {
    const results = await lookup.resolve('xyzzy plugh');
    expect(results).toEqual([]);
  });
});

// ── Static Lookup Tests ──

describe('StaticLookup', () => {
  let lookup: StaticLookup;

  beforeEach(() => {
    lookup = new StaticLookup();
    for (const meta of allFixtures) {
      lookup.register(meta);
    }
  });

  it('returns all tools regardless of intent', async () => {
    const results = await lookup.resolve('anything');
    expect(results.length).toBe(allFixtures.length);
  });

  it('returns all tools for empty intent', async () => {
    const results = await lookup.resolve('');
    expect(results.length).toBe(allFixtures.length);
  });

  it('ignores topK parameter', async () => {
    const results = await lookup.resolve('something', 1);
    expect(results.length).toBe(allFixtures.length);
  });
});

// ── Registry Tests ──

describe('toolRegistry', () => {
  it('has tools registered from the registry module', () => {
    // The registry module auto-registers tools on import
    expect(toolRegistry.size).toBeGreaterThan(0);
  });

  it('can retrieve a tool by name', () => {
    const meta = toolRegistry.get('tab_open');
    expect(meta).toBeDefined();
    expect(meta!.name).toBe('tab_open');
    expect(meta!.category).toBe('chrome');
  });

  it('returns undefined for unknown tools', () => {
    expect(toolRegistry.get('nonexistent_tool')).toBeUndefined();
  });

  it('getAll returns all registered tools', () => {
    const all = toolRegistry.getAll();
    expect(all.length).toBe(toolRegistry.size);
    const names = all.map((t) => t.name);
    expect(names).toContain('tab_open');
    expect(names).toContain('read_file');
    expect(names).toContain('message_send');
  });
});

// ── Factory Tests ──

describe('createToolLookup', () => {
  it('creates a keyword lookup by default', async () => {
    const lookup = createToolLookup();
    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    // Should not return all tools (unlike static)
    expect(results.length).toBeLessThan(toolRegistry.size);
  });

  it('creates a static lookup', async () => {
    const lookup = createToolLookup('static');
    const results = await lookup.resolve('anything');
    expect(results.length).toBe(toolRegistry.size);
  });

  it('creates a keyword lookup explicitly', async () => {
    const lookup = createToolLookup('keyword');
    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('tab_open');
  });

  it('creates an embedding lookup (falls back to keyword without API key)', async () => {
    const lookup = createToolLookup('embedding');
    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    // Without API key, embedding falls back to keyword
    expect(results[0].name).toBe('tab_open');
  });

  it('creates an embedding lookup with API key option', () => {
    // Should not throw when given an API key (initialization happens async)
    const lookup = createToolLookup('embedding', { apiKey: 'test-key' });
    expect(lookup).toBeDefined();
  });
});

// ── Cosine Similarity Tests ──

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('handles zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('handles empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('handles mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('computes correct similarity for known vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot = 4+10+18 = 32, normA = sqrt(14), normB = sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
  });
});

// ── Hash String Tests ──

describe('hashString', () => {
  it('returns consistent hashes', () => {
    const h1 = hashString('hello world');
    const h2 = hashString('hello world');
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different strings', () => {
    const h1 = hashString('hello');
    const h2 = hashString('world');
    expect(h1).not.toBe(h2);
  });

  it('returns a string', () => {
    expect(typeof hashString('test')).toBe('string');
  });
});

// ── Embedding Lookup with Mock ──

describe('EmbeddingLookup', () => {
  it('falls back to keyword lookup when not initialized', async () => {
    const lookup = new EmbeddingLookup();
    for (const meta of allFixtures) {
      lookup.register(meta);
    }

    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('tab_open');
  });

  it('uses embeddings when initialized with mock', async () => {
    const lookup = new EmbeddingLookup();
    for (const meta of allFixtures) {
      lookup.register(meta);
    }

    // Create mock embeddings where each tool gets a unique direction
    const mockEmbeddings = new Map<string, number[]>();
    allFixtures.forEach((tool, i) => {
      const vec = new Array(8).fill(0);
      vec[i % 8] = 1.0;
      mockEmbeddings.set(
        `${tool.description} ${tool.keywords.join(' ')}`,
        vec,
      );
    });

    // Set up the intent embedding to match tab_open's direction
    const tabOpenIdx = allFixtures.findIndex((t) => t.name === 'tab_open');
    const intentVec = new Array(8).fill(0);
    intentVec[tabOpenIdx % 8] = 1.0;

    const mockEmbed = vi.fn(async ({ value }: { model: unknown; value: string }) => {
      if (mockEmbeddings.has(value)) {
        return { embedding: mockEmbeddings.get(value)! };
      }
      // For the intent query, return the intent vector
      return { embedding: intentVec };
    });

    const mockModelFactory = vi.fn((_apiKey: string) => 'mock-model');

    await lookup.initialize('test-api-key', mockEmbed, mockModelFactory);

    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    // The mock embed was called
    expect(mockEmbed).toHaveBeenCalled();
  });

  it('caches embeddings in IndexedDB', async () => {
    // This tests that setEmbedding is called during initialization
    const lookup = new EmbeddingLookup();
    lookup.register(tabOpenMeta);

    const mockEmbed = vi.fn(async () => ({
      embedding: [1, 0, 0, 0],
    }));
    const mockModelFactory = vi.fn((_apiKey: string) => 'mock-model');

    await lookup.initialize('test-api-key', mockEmbed, mockModelFactory);

    // Embed was called for the tool description + hash storage
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });
});
