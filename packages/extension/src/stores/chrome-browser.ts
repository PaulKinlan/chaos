/**
 * Chrome browser capability implementations for @chaos/sdk.
 *
 * Each class wraps the chrome.* APIs to implement the SDK's
 * BrowserCapabilities interfaces, plus TaskScheduler and PageParser.
 */

import type {
  BrowserCapabilities,
  BrowserTabs,
  BrowserBookmarks,
  BrowserHistory,
  BrowserDownloads,
  BrowserWindows,
  BrowserNotifications,
  BrowserClipboard,
  BrowserReadingList,
  TabInfo,
  BookmarkInfo,
  HistoryItem,
  DownloadInfo,
  WindowInfo,
  ReadingListItem,
} from '@chaos/sdk/browser';

import type {
  TaskScheduler,
  PageParser,
  ScheduledTask,
} from '@chaos/sdk/services';

// ── Tabs ──

export class ChromeBrowserTabs implements BrowserTabs {
  async list(options?: { windowId?: string; active?: boolean }): Promise<TabInfo[]> {
    const query: chrome.tabs.QueryInfo = {};
    if (options?.windowId !== undefined) query.windowId = Number(options.windowId);
    if (options?.active !== undefined) query.active = options.active;
    const tabs = await chrome.tabs.query(query);
    return tabs.map((tab) => ({
      id: String(tab.id!),
      url: tab.url ?? '',
      title: tab.title ?? '',
      active: tab.active ?? false,
      pinned: tab.pinned,
      muted: tab.mutedInfo?.muted,
      groupId: tab.groupId,
      windowId: String(tab.windowId),
    }));
  }

  async open(url: string, options?: { active?: boolean; windowId?: string }): Promise<TabInfo> {
    const createProps: chrome.tabs.CreateProperties = { url };
    if (options?.active !== undefined) createProps.active = options.active;
    if (options?.windowId !== undefined) createProps.windowId = Number(options.windowId);
    const tab = await chrome.tabs.create(createProps);
    return {
      id: String(tab.id!),
      url: tab.pendingUrl ?? tab.url ?? url,
      title: tab.title ?? '',
      active: tab.active ?? false,
      windowId: String(tab.windowId),
    };
  }

  async close(tabId: string): Promise<void> {
    await chrome.tabs.remove(Number(tabId));
  }

  async focus(tabId: string): Promise<void> {
    const tab = await chrome.tabs.update(Number(tabId), { active: true });
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  }

  async navigate(tabId: string, url: string): Promise<void> {
    await chrome.tabs.update(Number(tabId), { url });
  }

  async duplicate(tabId: string): Promise<TabInfo> {
    const tab = await chrome.tabs.duplicate(Number(tabId));
    return {
      id: String(tab!.id!),
      url: tab?.url ?? tab?.pendingUrl ?? '',
      title: tab?.title ?? '',
      active: tab?.active ?? false,
      windowId: String(tab?.windowId),
    };
  }

  async move(tabId: string, options: { index: number; windowId?: string }): Promise<void> {
    const moveProps: chrome.tabs.MoveProperties = { index: options.index };
    if (options.windowId !== undefined) moveProps.windowId = Number(options.windowId);
    await chrome.tabs.move(Number(tabId), moveProps);
  }

  async pin(tabId: string, pinned: boolean): Promise<void> {
    await chrome.tabs.update(Number(tabId), { pinned });
  }

  async mute(tabId: string, muted: boolean): Promise<void> {
    await chrome.tabs.update(Number(tabId), { muted });
  }

  async group(tabIds: string[], options?: { title?: string; color?: string }): Promise<string> {
    const numericIds = tabIds.map(Number);
    const groupId = await chrome.tabs.group({ tabIds: numericIds });
    if (options?.title || options?.color) {
      const updateProps: chrome.tabGroups.UpdateProperties = {};
      if (options.title) updateProps.title = options.title;
      if (options.color) updateProps.color = options.color as chrome.tabGroups.ColorEnum;
      await chrome.tabGroups.update(groupId, updateProps);
    }
    return String(groupId);
  }

  async ungroup(tabIds: string[]): Promise<void> {
    await chrome.tabs.ungroup(tabIds.map(Number));
  }

  async read(tabId: string): Promise<{ title: string; url: string; content: string }> {
    const numericId = Number(tabId);

    // Tier 1: Try messaging the content script
    try {
      const response = await chrome.tabs.sendMessage(numericId, {
        type: 'extractContent',
      }) as { title: string; url: string; content: string } | undefined;
      if (response?.content) {
        return { title: response.title, url: response.url, content: response.content };
      }
    } catch {
      // Content script not present — try tier 2
    }

    // Tier 2: Inline extraction fallback
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: numericId },
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
          return { title, url, content };
        },
      });
      const result = results?.[0]?.result as { title: string; url: string; content: string } | undefined;
      if (result) return result;
    } catch {
      // Can't inject into this page
    }

    // Last resort: basic tab info
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.id === numericId);
    return {
      title: tab?.title ?? '',
      url: tab?.url ?? '',
      content: '',
    };
  }

  async screenshot(options?: { windowId?: string }): Promise<string> {
    const windowId = options?.windowId ? Number(options.windowId) : undefined;
    const dataUrl = await chrome.tabs.captureVisibleTab(
      windowId as unknown as number,
      { format: 'png' },
    );
    return dataUrl;
  }
}

// ── Bookmarks ──

export class ChromeBrowserBookmarks implements BrowserBookmarks {
  async list(folderId?: string): Promise<BookmarkInfo[]> {
    if (folderId) {
      const children = await chrome.bookmarks.getChildren(folderId);
      return children.map(this.mapBookmark);
    }
    const tree = await chrome.bookmarks.getTree();
    return this.flattenTree(tree);
  }

  async search(query: string): Promise<BookmarkInfo[]> {
    const results = await chrome.bookmarks.search(query);
    return results.filter((b) => b.url).map(this.mapBookmark);
  }

  async add(url: string, title: string, folderId?: string): Promise<BookmarkInfo> {
    const createDetails: { url: string; title: string; parentId?: string } = { url, title };
    if (folderId) createDetails.parentId = folderId;
    const bookmark = await chrome.bookmarks.create(createDetails);
    return this.mapBookmark(bookmark);
  }

  async remove(id: string): Promise<void> {
    await chrome.bookmarks.remove(id);
  }

  async getTree(): Promise<BookmarkInfo[]> {
    const tree = await chrome.bookmarks.getTree();
    return tree.map((node) => this.mapBookmarkTree(node));
  }

  private mapBookmark(b: chrome.bookmarks.BookmarkTreeNode): BookmarkInfo {
    return {
      id: b.id,
      url: b.url,
      title: b.title,
      parentId: b.parentId,
      dateAdded: b.dateAdded,
    };
  }

  private mapBookmarkTree(node: chrome.bookmarks.BookmarkTreeNode): BookmarkInfo {
    return {
      id: node.id,
      url: node.url,
      title: node.title,
      parentId: node.parentId,
      dateAdded: node.dateAdded,
      children: node.children?.map((child) => this.mapBookmarkTree(child)),
    };
  }

  private flattenTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): BookmarkInfo[] {
    const result: BookmarkInfo[] = [];
    const walk = (list: chrome.bookmarks.BookmarkTreeNode[]) => {
      for (const node of list) {
        if (node.url) result.push(this.mapBookmark(node));
        if (node.children) walk(node.children);
      }
    };
    walk(nodes);
    return result;
  }
}

// ── History ──

export class ChromeBrowserHistory implements BrowserHistory {
  async search(query: string, options?: { maxResults?: number; startTime?: number }): Promise<HistoryItem[]> {
    const searchParams: chrome.history.HistoryQuery = {
      text: query,
      maxResults: options?.maxResults ?? 20,
    };
    if (options?.startTime !== undefined) {
      searchParams.startTime = options.startTime;
    }
    const results = await chrome.history.search(searchParams);
    return results.map((item) => ({
      url: item.url ?? '',
      title: item.title ?? '',
      lastVisitTime: item.lastVisitTime,
      visitCount: item.visitCount,
    }));
  }
}

// ── Downloads ──

export class ChromeBrowserDownloads implements BrowserDownloads {
  async download(url: string, options?: { filename?: string }): Promise<DownloadInfo> {
    const downloadOptions: chrome.downloads.DownloadOptions = { url };
    if (options?.filename) downloadOptions.filename = options.filename;
    const downloadId = await chrome.downloads.download(downloadOptions);
    return {
      id: String(downloadId),
      url,
      filename: options?.filename ?? '',
      state: 'in_progress',
    };
  }

  async list(query?: { query?: string; limit?: number }): Promise<DownloadInfo[]> {
    const searchOptions: chrome.downloads.DownloadQuery = {
      limit: query?.limit ?? 20,
      orderBy: ['-startTime'],
    };
    if (query?.query) searchOptions.query = [query.query];
    const results = await chrome.downloads.search(searchOptions);
    return results.map((d) => ({
      id: String(d.id),
      url: d.url,
      filename: d.filename,
      state: d.state,
      fileSize: d.fileSize,
      startTime: d.startTime,
    }));
  }
}

// ── Windows ──

export class ChromeBrowserWindows implements BrowserWindows {
  async list(): Promise<WindowInfo[]> {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows.map((w) => ({
      id: String(w.id),
      focused: w.focused ?? false,
      type: w.type,
      width: w.width,
      height: w.height,
      left: w.left,
      top: w.top,
      tabCount: w.tabs?.length,
    }));
  }

  async create(options?: { url?: string; width?: number; height?: number; left?: number; top?: number; type?: string }): Promise<WindowInfo> {
    const createData: chrome.windows.CreateData = {};
    if (options?.url) createData.url = options.url;
    if (options?.width) createData.width = options.width;
    if (options?.height) createData.height = options.height;
    if (options?.left) createData.left = options.left;
    if (options?.top) createData.top = options.top;
    if (options?.type) createData.type = options.type as 'normal' | 'popup' | 'panel';
    const window = await chrome.windows.create(createData);
    return {
      id: String(window.id),
      focused: window.focused ?? false,
      type: window.type,
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
    };
  }

  async close(windowId: string): Promise<void> {
    await chrome.windows.remove(Number(windowId));
  }

  async focus(windowId: string): Promise<void> {
    await chrome.windows.update(Number(windowId), { focused: true });
  }

  async resize(windowId: string, bounds: { width?: number; height?: number; left?: number; top?: number }): Promise<void> {
    const updateInfo: chrome.windows.UpdateInfo = {};
    if (bounds.width !== undefined) updateInfo.width = bounds.width;
    if (bounds.height !== undefined) updateInfo.height = bounds.height;
    if (bounds.left !== undefined) updateInfo.left = bounds.left;
    if (bounds.top !== undefined) updateInfo.top = bounds.top;
    await chrome.windows.update(Number(windowId), updateInfo);
  }
}

// ── Notifications ──

export class ChromeBrowserNotifications implements BrowserNotifications {
  async show(title: string, message: string, options?: { iconUrl?: string }): Promise<void> {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: options?.iconUrl ?? chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
    });
  }
}

// ── Clipboard ──

export class ChromeBrowserClipboard implements BrowserClipboard {
  async write(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async read(): Promise<string> {
    return navigator.clipboard.readText();
  }
}

// ── Reading List ──

export class ChromeBrowserReadingList implements BrowserReadingList {
  async add(url: string, title: string): Promise<void> {
    await chrome.readingList.addEntry({ url, title, hasBeenRead: false });
  }

  async query(options?: { url?: string }): Promise<ReadingListItem[]> {
    const queryObj: { url?: string } = {};
    if (options?.url) queryObj.url = options.url;
    const entries = await chrome.readingList.query(queryObj);
    return (entries as chrome.readingList.ReadingListEntry[]).map((e) => ({
      url: e.url,
      title: e.title,
      hasBeenRead: e.hasBeenRead,
      createdTime: e.creationTime,
    }));
  }
}

// ── TaskScheduler ──

export class ChromeTaskScheduler implements TaskScheduler {
  private listener: ((task: ScheduledTask) => Promise<void>) | null = null;

  constructor() {
    // Listen for alarm events
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (this.listener) {
        const task: ScheduledTask = {
          id: alarm.name,
          name: alarm.name,
          scheduledTime: alarm.scheduledTime,
          periodInMinutes: alarm.periodInMinutes,
        };
        this.listener(task).catch(console.error);
      }
    });
  }

  async schedule(name: string, options: { delayInMinutes?: number; periodInMinutes?: number }): Promise<void> {
    const alarmInfo: chrome.alarms.AlarmCreateInfo = {};
    if (options.delayInMinutes !== undefined) alarmInfo.delayInMinutes = options.delayInMinutes;
    if (options.periodInMinutes !== undefined) alarmInfo.periodInMinutes = options.periodInMinutes;
    if (alarmInfo.delayInMinutes === undefined && alarmInfo.periodInMinutes === undefined) {
      alarmInfo.delayInMinutes = 1;
    }
    await chrome.alarms.create(name, alarmInfo);
  }

  async list(): Promise<ScheduledTask[]> {
    const alarms = await chrome.alarms.getAll();
    return alarms.map((alarm) => ({
      id: alarm.name,
      name: alarm.name,
      scheduledTime: alarm.scheduledTime,
      periodInMinutes: alarm.periodInMinutes,
    }));
  }

  async cancel(name: string): Promise<void> {
    await chrome.alarms.clear(name);
  }

  onTriggered(listener: (task: ScheduledTask) => Promise<void>): void {
    this.listener = listener;
  }
}

// ── PageParser ──

/**
 * Ensure the offscreen parser document exists.
 */
async function ensureOffscreenParser(): Promise<boolean> {
  try {
    if (!chrome.offscreen) return false;
    const contexts = await (chrome.runtime as unknown as {
      getContexts(filter: { contextTypes: string[] }): Promise<{ documentUrl: string }[]>;
    }).getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts && contexts.length > 0) return true;
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

export class ChromePageParser implements PageParser {
  async parse(html: string, url: string): Promise<{ title: string; content: string; textContent: string }> {
    // Try offscreen document parsing first
    try {
      const available = await ensureOffscreenParser();
      if (available) {
        const response = await chrome.runtime.sendMessage({
          type: 'parseHtml',
          html,
          url,
        }) as { title: string; content: string } | undefined;
        if (response?.content) {
          return {
            title: response.title,
            content: response.content,
            textContent: response.content, // offscreen returns markdown, use as textContent too
          };
        }
      }
    } catch {
      // Fall through to regex fallback
    }

    // Fallback: regex-based extraction
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const textContent = this.htmlToText(html);
    return { title, content: textContent, textContent };
  }

  private htmlToText(html: string): string {
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

    cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
    cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
    cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
    cleaned = cleaned.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n');

    cleaned = cleaned.replace(/<\/p>/gi, '\n\n');
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
    cleaned = cleaned.replace(/<\/div>/gi, '\n');
    cleaned = cleaned.replace(/<li[^>]*>/gi, '\n- ');
    cleaned = cleaned.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));

    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
  }
}

// ── Factory ──

export function createChromeBrowser(): BrowserCapabilities {
  return {
    tabs: new ChromeBrowserTabs(),
    bookmarks: new ChromeBrowserBookmarks(),
    history: new ChromeBrowserHistory(),
    downloads: new ChromeBrowserDownloads(),
    windows: new ChromeBrowserWindows(),
    notifications: new ChromeBrowserNotifications(),
    clipboard: new ChromeBrowserClipboard(),
    readingList: new ChromeBrowserReadingList(),
  };
}
