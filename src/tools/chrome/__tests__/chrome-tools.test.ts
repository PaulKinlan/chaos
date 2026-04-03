/**
 * Chrome Tools Tests
 *
 * Tests for all Chrome API tools. Mocks chrome.* APIs globally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getChromeTools } from '../index.js';

// ── Mock chrome.* APIs ──

const mockStorageData: Record<string, unknown> = {};

const mockChrome = {
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    group: vi.fn(),
    sendMessage: vi.fn(),
    duplicate: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
  },
  tabGroups: {
    update: vi.fn(),
  },
  windows: {
    create: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  bookmarks: {
    search: vi.fn(),
    create: vi.fn(),
    getChildren: vi.fn(),
  },
  history: {
    search: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    getAll: vi.fn(),
  },
  downloads: {
    download: vi.fn(),
    search: vi.fn(),
  },
  readingList: {
    addEntry: vi.fn(),
    query: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  permissions: {
    contains: vi.fn(async () => true),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorageData[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorageData, obj);
      }),
    },
  },
};

// Install mock globally
vi.stubGlobal('chrome', mockChrome);

const AGENT_ID = 'test-agent';

describe('getChromeTools', () => {
  it('returns all expected tool keys', async () => {
    const tools = await getChromeTools(AGENT_ID);
    const keys = Object.keys(tools);
    expect(keys).toContain('tab_read');
    expect(keys).toContain('tab_open');
    expect(keys).toContain('tab_close');
    expect(keys).toContain('tab_list');
    expect(keys).toContain('tab_group');
    expect(keys).toContain('bookmark_add');
    expect(keys).toContain('bookmark_search');
    expect(keys).toContain('bookmark_list');
    expect(keys).toContain('history_search');
    expect(keys).toContain('alarm_set');
    expect(keys).toContain('alarm_clear');
    expect(keys).toContain('alarm_list');
    expect(keys).toHaveLength(31);
  });
});

describe('tab_read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the active tab when no tabId provided', async () => {
    mockChrome.tabs.query.mockResolvedValue([{ id: 42 }]);
    mockChrome.scripting.executeScript.mockResolvedValue([{
      result: {
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Hello',
        excerpt: 'Hello',
      },
    }]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_read.execute!(
      { tabId: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(mockChrome.scripting.executeScript).toHaveBeenCalled();
    expect(result).toHaveProperty('title', 'Test Page');
  });

  it('reads a specific tab by tabId', async () => {
    mockChrome.scripting.executeScript.mockResolvedValue([{
      result: {
        title: 'Specific Tab',
        url: 'https://example.com/page',
        content: 'content',
        excerpt: 'excerpt',
      },
    }]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_read.execute!(
      { tabId: 99 },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.scripting.executeScript).toHaveBeenCalled();
    expect(result).toHaveProperty('title', 'Specific Tab');
  });

  it('handles error when no active tab found', async () => {
    mockChrome.tabs.query.mockResolvedValue([{}]); // no id

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_read.execute!(
      { tabId: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveProperty('excerpt', 'Error: No active tab found');
  });

  it('handles content script communication error', async () => {
    mockChrome.tabs.sendMessage.mockRejectedValue(new Error('No content script'));

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_read.execute!(
      { tabId: 5 },
      { toolCallId: 'test', messages: [] },
    );

    const excerpt = (result as { excerpt: string }).excerpt;
    expect(excerpt).toBeTruthy();
    expect(excerpt.length).toBeGreaterThan(0);
  });
});

describe('tab_open', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a URL in a new tab', async () => {
    mockChrome.tabs.create.mockResolvedValue({
      id: 10,
      pendingUrl: 'https://example.com',
    });

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_open.execute!(
      { url: 'https://example.com', active: false },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://example.com',
      active: false,
    });
    expect(result).toEqual({ tabId: 10, url: 'https://example.com' });
  });

  it('handles creation failure', async () => {
    mockChrome.tabs.create.mockRejectedValue(new Error('Invalid URL'));

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_open.execute!(
      { url: 'bad-url', active: false },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveProperty('error');
  });
});

describe('tab_close', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes a tab by ID', async () => {
    mockChrome.tabs.remove.mockResolvedValue(undefined);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_close.execute!(
      { tabId: 7 },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.tabs.remove).toHaveBeenCalledWith(7);
    expect(result).toEqual({ success: true, tabId: 7 });
  });

  it('handles tab not found', async () => {
    mockChrome.tabs.remove.mockRejectedValue(new Error('Tab not found'));

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_close.execute!(
      { tabId: 999 },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual({
      success: false,
      tabId: 999,
      error: 'Failed to close tab: Tab not found',
    });
  });
});

describe('tab_list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists all tabs', async () => {
    mockChrome.tabs.query.mockResolvedValue([
      { id: 1, title: 'Tab 1', url: 'https://a.com', active: true },
      { id: 2, title: 'Tab 2', url: 'https://b.com', active: false },
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_list.execute!(
      { query: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual([
      { tabId: 1, title: 'Tab 1', url: 'https://a.com', active: true },
      { tabId: 2, title: 'Tab 2', url: 'https://b.com', active: false },
    ]);
  });

  it('filters tabs by query', async () => {
    mockChrome.tabs.query.mockResolvedValue([
      { id: 1, title: 'GitHub', url: 'https://github.com', active: false },
      { id: 2, title: 'Google', url: 'https://google.com', active: true },
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_list.execute!(
      { query: 'github' },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual([
      { tabId: 1, title: 'GitHub', url: 'https://github.com', active: false },
    ]);
  });
});

describe('tab_group', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a tab group', async () => {
    mockChrome.tabs.group.mockResolvedValue(5);
    mockChrome.tabGroups.update.mockResolvedValue({});

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_group.execute!(
      { tabIds: [1, 2], title: 'Research', color: 'blue' },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2] });
    expect(mockChrome.tabGroups.update).toHaveBeenCalledWith(5, {
      title: 'Research',
      color: 'blue',
    });
    expect(result).toEqual({ groupId: 5 });
  });

  it('handles group creation failure', async () => {
    mockChrome.tabs.group.mockRejectedValue(new Error('Invalid tab IDs'));

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.tab_group.execute!(
      { tabIds: [999], title: 'Bad' },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveProperty('error');
  });
});

describe('bookmark_add', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a bookmark to the agent folder (folder exists)', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([
      { id: '100', title: `CHAOS: ${AGENT_ID}` }, // folder (no url)
    ]);
    mockChrome.bookmarks.create.mockResolvedValue({
      id: '200',
      title: 'Test',
      url: 'https://example.com',
    });

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_add.execute!(
      { url: 'https://example.com', title: 'Test' },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: '100',
      title: 'Test',
      url: 'https://example.com',
    });
    expect(result).toHaveProperty('id', '200');
  });

  it('creates agent folder if it does not exist', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([]);
    mockChrome.bookmarks.create
      .mockResolvedValueOnce({ id: '300', title: `CHAOS: ${AGENT_ID}` }) // folder creation
      .mockResolvedValueOnce({ id: '301', title: 'New BM', url: 'https://new.com' }); // bookmark creation

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_add.execute!(
      { url: 'https://new.com', title: 'New BM' },
      { toolCallId: 'test', messages: [] },
    );

    // First call creates the folder
    expect(mockChrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: '2',
      title: `CHAOS: ${AGENT_ID}`,
    });
    expect(result).toHaveProperty('id', '301');
  });

  it('handles bookmark creation failure', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([
      { id: '100', title: `CHAOS: ${AGENT_ID}` },
    ]);
    mockChrome.bookmarks.create.mockRejectedValue(new Error('Quota exceeded'));

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_add.execute!(
      { url: 'https://fail.com', title: 'Fail' },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveProperty('error');
  });
});

describe('bookmark_search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches bookmarks', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([
      { title: 'Result', url: 'https://r.com', dateAdded: 1700000000000 },
      { title: 'Folder', dateAdded: 1700000000000 }, // no url, should be filtered
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_search.execute!(
      { query: 'result' },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveLength(1);
    expect((result as Array<{ title: string }>)[0].title).toBe('Result');
  });
});

describe('bookmark_list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists bookmarks in agent folder', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([
      { id: '50', title: `CHAOS: ${AGENT_ID}` },
    ]);
    mockChrome.bookmarks.getChildren.mockResolvedValue([
      { title: 'BM1', url: 'https://a.com', dateAdded: 1700000000000 },
      { title: 'BM2', url: 'https://b.com', dateAdded: 1700000000000 },
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_list.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveLength(2);
  });

  it('returns empty array when agent folder does not exist', async () => {
    mockChrome.bookmarks.search.mockResolvedValue([]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.bookmark_list.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual([]);
  });
});

describe('history_search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches history', async () => {
    mockChrome.history.search.mockResolvedValue([
      {
        title: 'Visited Page',
        url: 'https://visited.com',
        lastVisitTime: 1700000000000,
        visitCount: 3,
      },
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.history_search.execute!(
      { query: 'visited', maxResults: 20, startTime: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.history.search).toHaveBeenCalledWith({
      text: 'visited',
      maxResults: 20,
    });
    expect(result).toHaveLength(1);
    expect((result as Array<{ visitCount: number }>)[0].visitCount).toBe(3);
  });

  it('passes startTime when provided', async () => {
    mockChrome.history.search.mockResolvedValue([]);

    const tools = await getChromeTools(AGENT_ID);
    await tools.history_search.execute!(
      { query: 'test', maxResults: 10, startTime: 1700000000000 },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.history.search).toHaveBeenCalledWith({
      text: 'test',
      maxResults: 10,
      startTime: 1700000000000,
    });
  });
});

describe('alarm_set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
  });

  it('sets an alarm with agentId prefix', async () => {
    mockChrome.alarms.create.mockResolvedValue(undefined);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.alarm_set.execute!(
      { name: 'check-mail', delayInMinutes: 5, periodInMinutes: undefined, prompt: undefined, description: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.alarms.create).toHaveBeenCalledWith(
      `${AGENT_ID}:check-mail`,
      { delayInMinutes: 5 },
    );
    expect(result).toHaveProperty('name', `${AGENT_ID}:check-mail`);
  });

  it('defaults to 1 minute delay when no timing specified', async () => {
    mockChrome.alarms.create.mockResolvedValue(undefined);

    const tools = await getChromeTools(AGENT_ID);
    await tools.alarm_set.execute!(
      { name: 'default', delayInMinutes: undefined, periodInMinutes: undefined, prompt: undefined, description: undefined },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.alarms.create).toHaveBeenCalledWith(
      `${AGENT_ID}:default`,
      { delayInMinutes: 1 },
    );
  });
});

describe('alarm_clear', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears an alarm with agentId prefix', async () => {
    mockChrome.alarms.clear.mockResolvedValue(true);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.alarm_clear.execute!(
      { name: 'check-mail' },
      { toolCallId: 'test', messages: [] },
    );

    expect(mockChrome.alarms.clear).toHaveBeenCalledWith(`${AGENT_ID}:check-mail`);
    expect(result).toEqual({ name: `${AGENT_ID}:check-mail`, cleared: true });
  });
});

describe('alarm_list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only alarms for this agent', async () => {
    mockChrome.alarms.getAll.mockResolvedValue([
      { name: `${AGENT_ID}:alarm1`, scheduledTime: 1700000000000 },
      { name: `${AGENT_ID}:alarm2`, scheduledTime: 1700001000000, periodInMinutes: 5 },
      { name: 'other-agent:alarm3', scheduledTime: 1700002000000 },
    ]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.alarm_list.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toHaveLength(2);
    expect((result as Array<{ name: string }>)[0].name).toBe(`${AGENT_ID}:alarm1`);
    expect((result as Array<{ periodInMinutes?: number }>)[1].periodInMinutes).toBe(5);
  });

  it('returns empty array when no alarms exist', async () => {
    mockChrome.alarms.getAll.mockResolvedValue([]);

    const tools = await getChromeTools(AGENT_ID);
    const result = await tools.alarm_list.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual([]);
  });
});
