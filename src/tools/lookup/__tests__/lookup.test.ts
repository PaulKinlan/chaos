/**
 * Tool Lookup Tests
 *
 * Tests for keyword lookup, static lookup, registry, and factory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KeywordLookup } from '../keyword-lookup.js';
import { StaticLookup } from '../static-lookup.js';
import { EmbeddingLookup } from '../embedding-lookup.js';
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

  it('creates an embedding lookup (falls back to keyword)', async () => {
    const lookup = createToolLookup('embedding');
    const results = await lookup.resolve('open a new tab');
    expect(results.length).toBeGreaterThan(0);
    // Embedding stub delegates to keyword, so same result
    expect(results[0].name).toBe('tab_open');
  });
});
