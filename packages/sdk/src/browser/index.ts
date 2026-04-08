// ── Tabs ──

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
  pinned?: boolean;
  muted?: boolean;
  groupId?: number;
  windowId?: string;
}

export interface BrowserTabs {
  list(options?: { windowId?: string; active?: boolean }): Promise<TabInfo[]>;
  open(url: string, options?: { active?: boolean; windowId?: string }): Promise<TabInfo>;
  close(tabId: string): Promise<void>;
  focus(tabId: string): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  duplicate(tabId: string): Promise<TabInfo>;
  move(tabId: string, options: { index: number; windowId?: string }): Promise<void>;
  pin(tabId: string, pinned: boolean): Promise<void>;
  mute(tabId: string, muted: boolean): Promise<void>;
  group(tabIds: string[], options?: { title?: string; color?: string }): Promise<string>;
  ungroup(tabIds: string[]): Promise<void>;
  read(tabId: string): Promise<{ title: string; url: string; content: string }>;
  screenshot(options?: { windowId?: string }): Promise<string>; // base64
}

// ── Bookmarks ──

export interface BookmarkInfo {
  id: string;
  url?: string;
  title: string;
  parentId?: string;
  dateAdded?: number;
  children?: BookmarkInfo[];
}

export interface BrowserBookmarks {
  list(folderId?: string): Promise<BookmarkInfo[]>;
  search(query: string): Promise<BookmarkInfo[]>;
  add(url: string, title: string, folderId?: string): Promise<BookmarkInfo>;
  remove(id: string): Promise<void>;
  getTree(): Promise<BookmarkInfo[]>;
}

// ── History ──

export interface HistoryItem {
  url: string;
  title: string;
  lastVisitTime?: number;
  visitCount?: number;
}

export interface BrowserHistory {
  search(query: string, options?: { maxResults?: number; startTime?: number }): Promise<HistoryItem[]>;
}

// ── Downloads ──

export interface DownloadInfo {
  id: string;
  url: string;
  filename: string;
  state: string;
  fileSize?: number;
  startTime?: string;
}

export interface BrowserDownloads {
  download(url: string, options?: { filename?: string }): Promise<DownloadInfo>;
  list(query?: { query?: string; limit?: number }): Promise<DownloadInfo[]>;
}

// ── Windows ──

export interface WindowInfo {
  id: string;
  focused: boolean;
  type?: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  tabCount?: number;
}

export interface BrowserWindows {
  list(): Promise<WindowInfo[]>;
  create(options?: { url?: string; width?: number; height?: number; left?: number; top?: number; type?: string }): Promise<WindowInfo>;
  close(windowId: string): Promise<void>;
  focus(windowId: string): Promise<void>;
  resize(windowId: string, bounds: { width?: number; height?: number; left?: number; top?: number }): Promise<void>;
}

// ── Notifications ──

export interface BrowserNotifications {
  show(title: string, message: string, options?: { iconUrl?: string }): Promise<void>;
}

// ── Clipboard ──

export interface BrowserClipboard {
  write(text: string): Promise<void>;
  read?(): Promise<string>;
}

// ── Reading List ──

export interface ReadingListItem {
  url: string;
  title: string;
  hasBeenRead?: boolean;
  createdTime?: number;
}

export interface BrowserReadingList {
  add(url: string, title: string): Promise<void>;
  query(options?: { url?: string }): Promise<ReadingListItem[]>;
}

// ── Combined ──

export interface BrowserCapabilities {
  tabs?: BrowserTabs;
  bookmarks?: BrowserBookmarks;
  history?: BrowserHistory;
  downloads?: BrowserDownloads;
  windows?: BrowserWindows;
  notifications?: BrowserNotifications;
  clipboard?: BrowserClipboard;
  readingList?: BrowserReadingList;
}
