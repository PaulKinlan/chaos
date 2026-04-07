export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface BookmarkInfo {
  id: string;
  url: string;
  title: string;
  dateAdded?: number;
}

export interface HistoryItem {
  url: string;
  title: string;
  lastVisitTime?: number;
}

export interface BrowserCapabilities {
  tabs?: {
    list(): Promise<TabInfo[]>;
    read(tabId: string): Promise<string>;
    open(url: string): Promise<TabInfo>;
    close(tabId: string): Promise<void>;
    focus(tabId: string): Promise<void>;
    navigate(tabId: string, url: string): Promise<void>;
  };
  bookmarks?: {
    search(query: string): Promise<BookmarkInfo[]>;
    list(folderId?: string): Promise<BookmarkInfo[]>;
    add(url: string, title: string, folderId?: string): Promise<BookmarkInfo>;
    remove(id: string): Promise<void>;
  };
  history?: {
    search(query: string, maxResults?: number): Promise<HistoryItem[]>;
  };
  notifications?: {
    show(title: string, message: string, options?: { iconUrl?: string }): Promise<void>;
  };
  clipboard?: {
    write(text: string): Promise<void>;
    read(): Promise<string>;
  };
}
