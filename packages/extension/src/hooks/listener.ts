/**
 * Hooks Listener
 *
 * Loads all hooks on startup and registers Chrome event listeners.
 * When an event fires, checks if it matches any hook's trigger + filter.
 * If matched and the hook is enabled, runs the agent loop with the
 * hook's prompt plus event context.
 */

import { getHooks, updateHook } from '../storage/chrome-storage.js';
import { createExtensionAgent, mapProgressEvent } from '../agents/extension-agent.js';
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

// Set by background.ts so hooks can stream progress to the UI
let uiPortGetter: (() => chrome.runtime.Port | null) | null = null;

export function setHookUiPortGetter(getter: () => chrome.runtime.Port | null): void {
  uiPortGetter = getter;
}

async function executeHook(hook: Hook, contextMessage: string): Promise<void> {
  try {
    const fullPrompt = `[Hook triggered: ${hook.description}]\n\nEvent context: ${contextMessage}\n\nInstructions: ${hook.prompt}\n\nIf your work produces a result the user would want to see, publish it as an artifact using artifact_publish.`;
    const port = uiPortGetter?.() ?? null;

    // Notify UI to open a column for this hook
    if (port) {
      try {
        port.postMessage({
          type: 'channelMessageReceived',
          agentId: hook.agentId,
          channelLabel: `Hook`,
          from: hook.description,
          content: contextMessage,
          channelType: 'hook',
          channelId: hook.id,
        });
        port.postMessage({ type: 'agenticStart', agentId: hook.agentId });
      } catch { /* port disconnected */ }
    }

    console.log(`[hooks] Executing hook "${hook.description}" for agent ${hook.agentId}`);

    const { agent: hookAgent } = await createExtensionAgent(hook.agentId, {
      task: fullPrompt,
      source: 'hook',
    });

    let result = '';
    for await (const event of hookAgent.stream(fullPrompt)) {
      if (event.type === 'done' || event.type === 'text') {
        result = event.content;
      }
      if (!port) continue;
      const update = mapProgressEvent(event, 20);
      try {
        port.postMessage({
          type: 'agenticProgress',
          agentId: hook.agentId,
          progressType: update.type,
          content: update.content,
          toolName: update.toolName,
          toolArgs: update.toolArgs,
          toolResult: update.toolResult,
          iteration: update.iteration,
          totalIterations: update.totalIterations,
        });
      } catch { /* port disconnected */ }
    }

    if (port) {
      try { port.postMessage({ type: 'agenticDone', result, agentId: hook.agentId }); } catch { /* */ }
    }

    // Update trigger stats
    await updateHook(hook.id, {
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: hook.triggerCount + 1,
    });

    console.log(`[hooks] Hook "${hook.description}" completed`);
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
    let matched = false;

    for (const hook of hooks) {
      const trigger = hook.trigger as Extract<HookTrigger, { type: 'omnibox' }>;
      if (!text.toLowerCase().startsWith(trigger.keyword.toLowerCase())) continue;

      const input = text.slice(trigger.keyword.length).trim();
      const context = `Omnibox input: keyword="${trigger.keyword}", text="${input}"`;
      executeHook(hook, context);
      matched = true;
    }

    // If no hook matched, open a new chat column with the text as prompt
    if (!matched && text.trim()) {
      console.log(`[hooks] Omnibox: no matching hook, sending to chat: "${text.slice(0, 80)}"`);
      // Open/focus the CHAOS tab and send the prompt
      try {
        const tabs = await chrome.tabs.query({});
        const chaosTab = tabs.find((t) => t.url?.includes('app.html'));
        if (chaosTab?.id) {
          await chrome.tabs.update(chaosTab.id, { active: true });
          if (chaosTab.windowId) await chrome.windows.update(chaosTab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
        }
        // Send message to the UI to create a new chat column with the prompt
        chrome.runtime.sendMessage({
          type: 'omniboxChat',
          prompt: text.trim(),
        }).catch(() => {});
      } catch (err) {
        console.error('[hooks] Omnibox chat failed:', err);
      }
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

// ── Clipboard listener ──

function registerClipboardListener(): void {
  // The clipboardchange event fires when the system clipboard content changes.
  // Requires clipboardRead permission. Available in Chrome 124+.
  // In a service worker context, we need to use self.addEventListener.
  try {
    (self as unknown as EventTarget).addEventListener('clipboardchange', async () => {
      const hooks = await getEnabledHooks();
      const matching = hooks.filter((h) => h.trigger.type === 'clipboard-changed');
      if (matching.length === 0) return;

      let content = '(could not read clipboard)';
      try {
        // Read clipboard text
        const items = await (navigator as any).clipboard.readText();
        content = typeof items === 'string' ? items.slice(0, 500) : String(items).slice(0, 500);
      } catch {
        // Clipboard read may require focus or permission
      }

      const context = `Clipboard changed. Content preview: ${content}`;
      for (const hook of matching) {
        executeHook(hook, context);
      }
    });
    console.log('[hooks] Clipboard change listener registered');
  } catch {
    console.log('[hooks] clipboardchange event not available in this context');
  }
}

// ── FileSystem Observer listener ──
// FileSystemObserver needs to run in a page context (not service worker)
// because it requires a FileSystemHandle from showDirectoryPicker().
// The app page starts observations and notifies via chrome.runtime.sendMessage.

function registerFileSystemListener(): void {
  // Listen for filesystem change events forwarded from the app page.
  // IMPORTANT: Must not be async and must return false/undefined for
  // messages we don't handle, otherwise we block other onMessage listeners.
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg.type !== 'filesystemChanged') return false; // Not ours, let other listeners handle it

    // Handle async without making the listener async (which would return a Promise)
    (async () => {
      const hooks = await getEnabledHooks();
      const matching = hooks.filter((h) => h.trigger.type === 'filesystem-changed');
      for (const hook of matching) {
        const trigger = hook.trigger as Extract<HookTrigger, { type: 'filesystem-changed' }>;
        if (trigger.path && !msg.path?.includes(trigger.path)) continue;
        const context = `File system change detected: ${msg.changeType || 'modified'} — ${msg.path || 'unknown path'}`;
        executeHook(hook, context);
      }
    })();
    return false; // Don't hold the message channel open
  });
  console.log('[hooks] FileSystem observer hook listener registered');
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
  registerClipboardListener();
  registerFileSystemListener();

  console.log('CHAOS hooks listeners initialized');
}
