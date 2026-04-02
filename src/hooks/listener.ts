/**
 * Hooks Listener
 *
 * Loads all hooks on startup and registers Chrome event listeners.
 * When an event fires, checks if it matches any hook's trigger + filter.
 * If matched and the hook is enabled, runs the agent loop with the
 * hook's prompt plus event context.
 */

import { getHooks, updateHook } from '../storage/chrome-storage.js';
import { runAgentLoop } from '../agents/loop.js';
import type { Hook, HookTrigger } from '../storage/types.js';

// ── Glob pattern matching ──

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports * (match any chars) and ? (match single char).
 * Dots and other regex chars are escaped.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

// ── Hook execution ──

async function executeHook(hook: Hook, contextMessage: string): Promise<void> {
  try {
    const fullPrompt = `[Hook triggered: ${hook.description}]\n\nEvent context: ${contextMessage}\n\nInstructions: ${hook.prompt}`;

    await runAgentLoop({
      agentId: hook.agentId,
      userMessage: fullPrompt,
    });

    // Update trigger stats
    await updateHook(hook.id, {
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: hook.triggerCount + 1,
    });
  } catch (err) {
    console.error(`Hook "${hook.description}" (${hook.id}) failed:`, err);
  }
}

async function getEnabledHooks(): Promise<Hook[]> {
  const hooks = await getHooks();
  return hooks.filter((h) => h.enabled);
}

function matchesType(hook: Hook, type: HookTrigger['type']): boolean {
  return hook.trigger.type === type;
}

// ── Event listeners ──

function registerBookmarkListener(): void {
  chrome.bookmarks?.onCreated?.addListener(async (_id, bookmark) => {
    if (!bookmark.url) return;

    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'bookmark-created'));
    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'bookmark-created' }>;

      // Check folder filter
      if (trigger.folderId && bookmark.parentId !== trigger.folderId) continue;

      const context = `Bookmark created: "${bookmark.title}" - ${bookmark.url} (folder: ${bookmark.parentId})`;
      executeHook(hook, context);
    }
  });
}

function registerTabNavigatedListener(): void {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'tab-navigated'));
    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'tab-navigated' }>;
      const regex = globToRegex(trigger.urlPattern);
      if (!regex.test(tab.url)) continue;

      const context = `Tab navigated to: "${tab.title}" - ${tab.url} (tabId: ${tabId})`;
      executeHook(hook, context);
    }
  });
}

function registerTabCreatedListener(): void {
  chrome.tabs.onCreated.addListener(async (tab) => {
    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'tab-created'));
    for (const hook of hooks) {
      const context = `New tab created: "${tab.title || '(untitled)'}" - ${tab.url || tab.pendingUrl || '(no url)'} (tabId: ${tab.id})`;
      executeHook(hook, context);
    }
  });
}

function registerTabClosedListener(): void {
  chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'tab-closed'));
    for (const hook of hooks) {
      const context = `Tab closed: tabId ${tabId}, windowId ${removeInfo.windowId}, windowClosing: ${removeInfo.isWindowClosing}`;
      executeHook(hook, context);
    }
  });
}

function registerDownloadCompletedListener(): void {
  chrome.downloads?.onChanged?.addListener(async (delta) => {
    if (!delta.state || delta.state.current !== 'complete') return;

    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'download-completed'));

    // Get download info for filename matching
    let downloads: chrome.downloads.DownloadItem[] = [];
    try {
      downloads = await chrome.downloads.search({ id: delta.id });
    } catch {
      return;
    }
    const download = downloads[0];
    if (!download) return;

    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'download-completed' }>;

      if (trigger.filenamePattern) {
        const regex = globToRegex(trigger.filenamePattern);
        const filename = download.filename.split('/').pop() || download.filename;
        if (!regex.test(filename)) continue;
      }

      const context = `Download completed: "${download.filename}" from ${download.url} (${download.totalBytes} bytes)`;
      executeHook(hook, context);
    }
  });
}

function registerHistoryVisitedListener(): void {
  chrome.history?.onVisited?.addListener(async (result) => {
    if (!result.url) return;

    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'history-visited'));
    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'history-visited' }>;
      const regex = globToRegex(trigger.urlPattern);
      if (!regex.test(result.url)) continue;

      const context = `Page visited: "${result.title || ''}" - ${result.url}`;
      executeHook(hook, context);
    }
  });
}

function registerIdleChangedListener(): void {
  chrome.idle?.onStateChanged?.addListener(async (newState) => {
    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'idle-changed'));
    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'idle-changed' }>;
      if (trigger.state !== newState) continue;

      const context = `Idle state changed to: ${newState}`;
      executeHook(hook, context);
    }
  });
}

function registerBrowserStartupListener(): void {
  chrome.runtime.onStartup.addListener(async () => {
    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'browser-startup'));
    for (const hook of hooks) {
      const context = 'Browser started up';
      executeHook(hook, context);
    }
  });
}

function registerOmniboxListener(): void {
  chrome.omnibox?.onInputEntered?.addListener(async (text) => {
    const hooks = (await getEnabledHooks()).filter((h) => matchesType(h, 'omnibox'));
    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'omnibox' }>;

      // Check if the text starts with the keyword
      if (!text.toLowerCase().startsWith(trigger.keyword.toLowerCase())) continue;

      const input = text.slice(trigger.keyword.length).trim();
      const context = `Omnibox input: keyword="${trigger.keyword}", text="${input}"`;
      executeHook(hook, context);
    }
  });
}

// ── Window listeners ──

function registerWindowCreatedListener(): void {
  chrome.windows?.onCreated?.addListener(async (window) => {
    const hooks = await getEnabledHooks();
    const matching = hooks.filter((h) => h.trigger.type === 'window-created');
    const context = `A new browser window was created (id: ${window.id}, type: ${window.type}).`;
    for (const hook of matching) {
      executeHook(hook, context);
    }
  });
}

function registerWindowFocusedListener(): void {
  chrome.windows?.onFocusChanged?.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    const hooks = await getEnabledHooks();
    const matching = hooks.filter((h) => h.trigger.type === 'window-focused');
    const context = `Browser window ${windowId} was focused.`;
    for (const hook of matching) {
      executeHook(hook, context);
    }
  });
}

function registerWindowClosedListener(): void {
  chrome.windows?.onRemoved?.addListener(async (windowId) => {
    const hooks = await getEnabledHooks();
    const matching = hooks.filter((h) => h.trigger.type === 'window-closed');
    const context = `Browser window ${windowId} was closed.`;
    for (const hook of matching) {
      executeHook(hook, context);
    }
  });
}

// ── Reading list listener ──

function registerReadingListListener(): void {
  // chrome.readingList doesn't have event listeners yet in the stable API,
  // but we can poll periodically via an alarm if reading-list-changed hooks exist.
  // For now, register a placeholder that checks on bookmark changes as a proxy.
  chrome.bookmarks?.onCreated?.addListener(async () => {
    const hooks = await getEnabledHooks();
    const matching = hooks.filter((h) => h.trigger.type === 'reading-list-changed');
    if (matching.length === 0) return;
    // Check if reading list permission is available
    try {
      const has = await chrome.permissions.contains({ permissions: ['readingList' as chrome.runtime.ManifestPermissions] });
      if (!has) return;
      const items = await (chrome as any).readingList.query({});
      const context = `Reading list updated. Current items: ${items.length}. Latest: ${items[0]?.title || 'none'}.`;
      for (const hook of matching) {
        executeHook(hook, context);
      }
    } catch {
      // readingList API not available
    }
  });
}

// ── Initialization ──

/**
 * Initialize all hook event listeners.
 * Call this once at service worker startup.
 */
export function initHooksListeners(): void {
  registerBookmarkListener();
  registerTabNavigatedListener();
  registerTabCreatedListener();
  registerTabClosedListener();
  registerDownloadCompletedListener();
  registerHistoryVisitedListener();
  registerIdleChangedListener();
  registerBrowserStartupListener();
  registerOmniboxListener();
  registerWindowCreatedListener();
  registerWindowFocusedListener();
  registerWindowClosedListener();
  registerReadingListListener();

  console.log('CHAOS hooks listeners initialized');
}
