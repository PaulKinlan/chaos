/**
 * Background Service Worker
 *
 * Handles:
 * - Side panel open on icon click
 * - Message routing between side panel, content scripts, and agent loop
 * - Long-lived port connections for streaming responses
 * - Context menu creation and handling
 * - Alarm-based agent wake-ups
 */

import {
  createAgent,
  listAgents,
  deleteAgent,
  getAgent,
  updateAgentMeta,
} from './agents/manager.js';
import { runAgentLoop } from './agents/loop.js';
import { runAgenticLoop } from './agents/agentic-loop.js';
import type { ProgressUpdate } from './agents/agentic-loop.js';
import {
  getApiKeys,
  setApiKeys,
  getScheduledTasks,
  addScheduledTask,
  updateScheduledTaskRun,
  removeScheduledTask,
  getHooks,
  addHook,
  updateHook,
  removeHook,
} from './storage/chrome-storage.js';
import { getMessages } from './storage/shared.js';
import { getTaskState } from './storage/shared.js';
import { listArtifacts } from './storage/shared.js';
import { opfs } from './storage/opfs.js';
import {
  getConversation,
  setConversation,
  listConversations,
  deleteConversation,
} from './storage/idb.js';
import type { Conversation, ConversationMessage } from './storage/types.js';
import {
  hasPermission,
  ensureContentExtraction,
  ensurePermission,
} from './permissions.js';
import { initHooksListeners } from './hooks/listener.js';

// ── OPFS directory listing helper ──

interface OPFSFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: OPFSFileEntry[];
}

async function listOPFSDir(basePath: string): Promise<OPFSFileEntry[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const segments = basePath.split('/').filter(Boolean);
    let dir = root;
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    return await readDirRecursive(dir, '');
  } catch {
    return [];
  }
}

async function readDirRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<OPFSFileEntry[]> {
  const entries: OPFSFileEntry[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      const children = await readDirRecursive(
        handle as FileSystemDirectoryHandle,
        path,
      );
      entries.push({ name, path, kind: 'directory', children });
    } else {
      let size: number | undefined;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        size = file.size;
      } catch {
        // size unavailable
      }
      entries.push({ name, path, kind: 'file', size });
    }
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Content script registration ──

async function registerContentExtractor(): Promise<void> {
  try {
    const hasScripting = await chrome.permissions.contains({
      permissions: ['scripting'],
      origins: ['<all_urls>'],
    });
    if (!hasScripting) return;

    await chrome.scripting.registerContentScripts([{
      id: 'chaos-extractor',
      matches: ['<all_urls>'],
      js: ['src/content/extractor.js'],
      runAt: 'document_idle',
    }]);
  } catch {
    // May already be registered — that's fine
  }
}

// ── Extension icon click → open app.html ──

chrome.action.onClicked.addListener(async () => {
  await openOrFocusChaosTab();
});

async function openOrFocusChaosTab(): Promise<chrome.tabs.Tab> {
  const url = chrome.runtime.getURL('app.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0 && existing[0].id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return existing[0];
  }
  return chrome.tabs.create({ url });
}

// ── Installation ──

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('CHAOS extension installed', details.reason);
  setupContextMenus();
  registerContentExtractor();

  // On update, reload existing NTP tabs so they pick up the new extension version
  if (details.reason === 'update') {
    try {
      const ntpUrl = chrome.runtime.getURL('app.html');
      const tabs = await chrome.tabs.query({ url: ntpUrl });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.reload(tab.id);
        }
      }
    } catch (err) {
      console.warn('Failed to reload NTP tabs on update:', err);
    }
  }

  // On fresh install, create a default agent so the user has something to work with
  if (details.reason === 'install') {
    try {
      const agents = await listAgents();
      if (agents.length === 0) {
        const agent = await createAgent('Assistant', 'master');
        await updateAgentMeta(agent.id, { master: true, visibility: 'visible' });
        console.log('Created default master agent:', agent.id);
        // Set up the daily review for the default agent
        const alarmName = `${agent.id}:daily-review`;
        chrome.alarms.create(alarmName, {
          delayInMinutes: 60,
          periodInMinutes: 1440,
        });
        await addScheduledTask({
          alarmId: alarmName,
          agentId: agent.id,
          prompt: 'Daily review: Read through your memories/, activity-log.jsonl, TODO.md, and any pending messages. Look for patterns: stale TODOs (older than a week), repeated topics without action, and ignored suggestions. Write a brief daily review to memories/daily-reviews/ with today\'s date. Include: what happened recently, what\'s pending, and 1-3 proactive suggestions for things you could help with.',
          description: 'Daily review and proactive insights',
          createdAt: new Date().toISOString(),
          schedule: { type: 'recurring', periodInMinutes: 1440 },
        });
        await setupContextMenus(); // Refresh to include the new agent
      }
    } catch (err) {
      console.error('Failed to create default agent:', err);
    }
  }
});

// ── Startup ──

chrome.runtime.onStartup?.addListener(() => {
  registerContentExtractor();
});

// ── Initialize hooks event listeners ──
initHooksListeners();

// ── Context menus ──

async function setupContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();

  // Parent menu
  chrome.contextMenus.create({
    id: 'chaos-parent',
    title: 'Send to CHAOS agent',
    contexts: ['selection', 'page', 'link', 'image', 'video', 'audio'],
  });

  // Add child items per agent
  const agents = await listAgents();
  for (const agent of agents) {
    chrome.contextMenus.create({
      id: `chaos-agent-${agent.id}`,
      parentId: 'chaos-parent',
      title: agent.name,
      contexts: ['selection', 'page'],
    });
  }

  // If no agents, show a placeholder
  if (agents.length === 0) {
    chrome.contextMenus.create({
      id: 'chaos-no-agents',
      parentId: 'chaos-parent',
      title: '(no agents created yet)',
      enabled: false,
      contexts: ['selection', 'page'],
    });
  }

  // Add context-menu hook items
  const hooks = await getHooks();
  const contextMenuHooks = hooks.filter(
    (h) => h.enabled && h.trigger.type === 'context-menu',
  );
  if (contextMenuHooks.length > 0) {
    chrome.contextMenus.create({
      id: 'chaos-hooks-separator',
      parentId: 'chaos-parent',
      type: 'separator',
      contexts: ['selection', 'page'],
    });
    for (const hook of contextMenuHooks) {
      const trigger = hook.trigger as Extract<import('./storage/types.js').HookTrigger, { type: 'context-menu' }>;
      chrome.contextMenus.create({
        id: `chaos-hook-${hook.id}`,
        parentId: 'chaos-parent',
        title: trigger.label || hook.description,
        contexts: ['selection', 'page'],
      });
    }
  }
}

/** Refresh context menu items when agents change. */
async function refreshContextMenus(): Promise<void> {
  await setupContextMenus();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = String(info.menuItemId);
  const isAgent = menuId.startsWith('chaos-agent-');
  const isHook = menuId.startsWith('chaos-hook-');
  if (!isAgent && !isHook) return;

  // Build rich context from all available info
  const parts: string[] = [];

  if (info.linkUrl) {
    parts.push(`Link URL: ${info.linkUrl}`);
  }
  if (info.selectionText) {
    parts.push(`Selected text: ${info.selectionText}`);
  }
  if (info.srcUrl) {
    parts.push(`Media URL: ${info.srcUrl}`);
  }
  if (tab?.title) {
    parts.push(`Page title: ${tab.title}`);
  }
  if (tab?.url) {
    parts.push(`Page URL: ${tab.url}`);
  }

  // If no selection or link, try to extract page content
  if (!info.selectionText && !info.linkUrl && tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'extractContent',
      });
      if (response?.content) {
        parts.push(`Page content:\n${response.content}`);
      }
    } catch {
      // Content extraction failed, continue with what we have
    }
  }

  const content = parts.join('\n\n');
  if (!content) return;

  let agentId: string;
  let hookPrompt: string | undefined;

  if (isHook) {
    const hookId = menuId.replace('chaos-hook-', '');
    const hooks = await getHooks();
    const hook = hooks.find((h) => h.id === hookId);
    if (!hook) return;
    agentId = hook.agentId;
    hookPrompt = hook.prompt;

    // Update hook trigger stats
    await updateHook(hook.id, {
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: hook.triggerCount + 1,
    });
  } else {
    agentId = menuId.replace('chaos-agent-', '');
  }

  // Find or create the CHAOS tab and send the action there for visible progress
  try {
    const messagePayload = {
      type: 'contextMenuAction',
      agentId,
      content,
      hookPrompt,
    };

    const chaosTab = await openOrFocusChaosTab();
    if (chaosTab.id) {
      // Small delay to let the tab load if newly created
      setTimeout(() => {
        chrome.tabs.sendMessage(chaosTab.id!, messagePayload);
      }, chaosTab.status === 'complete' ? 0 : 1000);
    }
  } catch (err) {
    console.error('Failed to open NTP for context menu action:', err);
  }
});

// ── Active agent loop tracking (for keepalive and cancellation) ──

let activeLoopCount = 0;
const activeAbortControllers = new Map<chrome.runtime.Port, AbortController>();

function startKeepalive(): void {
  activeLoopCount++;
  if (activeLoopCount === 1) {
    chrome.alarms.create('chaos-keepalive', { periodInMinutes: 0.4 });
  }
}

function stopKeepalive(): void {
  activeLoopCount = Math.max(0, activeLoopCount - 1);
  if (activeLoopCount === 0) {
    chrome.alarms.clear('chaos-keepalive');
  }
}

// ── Port-based streaming communication ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chaos-sidepanel') return;

  port.onDisconnect.addListener(() => {
    // Cancel any active agent loop for this port
    const controller = activeAbortControllers.get(port);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(port);
    }
  });

  port.onMessage.addListener(async (msg) => {
    try {
      switch (msg.type) {
        case 'chat':
        case 'agenticChat':
          await handleAgenticChat(port, msg);
          break;

        case 'stopAgenticLoop': {
          const controller = activeAbortControllers.get(port);
          if (controller) {
            controller.abort();
          }
          break;
        }

        case 'extractContent':
          await handleExtractContent(port);
          break;

        case 'listAgents':
          await handleListAgents(port);
          break;

        case 'createAgent':
          await handleCreateAgent(port, msg);
          break;

        case 'deleteAgent':
          await handleDeleteAgent(port, msg);
          break;

        case 'getApiKeys':
          await handleGetApiKeys(port);
          break;

        case 'setApiKeys':
          await handleSetApiKeys(port, msg);
          break;

        case 'getSettings':
          await handleGetSettings(port);
          break;

        case 'setSettings':
          await handleSetSettings(port, msg);
          break;

        case 'saveConversation':
          await handleSaveConversation(port, msg);
          break;

        case 'getConversation':
          await handleGetConversation(port, msg);
          break;

        case 'clearConversation':
          await handleClearConversation(port, msg);
          break;

        case 'getAgentDetail':
          await handleGetAgentDetail(port, msg);
          break;

        case 'listAgentFiles':
          await handleListAgentFilesPort(port, msg);
          break;

        case 'readAgentFile':
          await handleReadAgentFilePort(port, msg);
          break;

        case 'updateAgentVisibility':
          await handleUpdateAgentVisibilityPort(port, msg);
          break;

        case 'updateAgentClaudeMd':
          await handleUpdateAgentClaudeMdPort(port, msg);
          break;

        case 'getHooks':
          await handleGetHooks(port, msg);
          break;

        case 'addHook':
          await handleAddHook(port, msg);
          break;

        case 'updateHook':
          await handleUpdateHookPort(port, msg);
          break;

        case 'removeHook':
          await handleRemoveHook(port, msg);
          break;

        default:
          port.postMessage({
            type: 'error',
            error: `Unknown message type: ${msg.type}`,
          });
      }
    } catch (err) {
      port.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

// ── Error parsing ──

/**
 * Parse an API error to produce a user-friendly message and identify the provider.
 */
function parseApiError(err: unknown): { message: string; provider?: string } {
  const raw = err instanceof Error ? err.message : String(err);

  // Try to extract provider from common error patterns
  let provider: string | undefined;
  if (raw.includes('anthropic') || raw.includes('claude')) provider = 'Anthropic';
  else if (raw.includes('openai') || raw.includes('gpt')) provider = 'OpenAI';
  else if (raw.includes('google') || raw.includes('gemini')) provider = 'Google';
  else if (raw.includes('openrouter')) provider = 'OpenRouter';

  // Check for provider name in the "No API key configured" message
  const providerMatch = raw.match(/No API key configured for provider:\s*(\w+)/);
  if (providerMatch) {
    provider = providerMatch[1];
    return { message: `No API key set for ${provider}. Add one in Settings.`, provider };
  }

  // Parse HTTP status codes
  if (raw.includes('401') || raw.toLowerCase().includes('unauthorized') || raw.toLowerCase().includes('invalid api key')) {
    return { message: 'Invalid API key. Check your key in Settings.', provider };
  }
  if (raw.includes('429') || raw.toLowerCase().includes('rate limit')) {
    return { message: 'Rate limit exceeded. Wait a moment and try again.', provider };
  }
  if (raw.includes('500') || raw.includes('502') || raw.includes('503')) {
    return { message: 'The API server is experiencing issues. Try again later.', provider };
  }
  if (raw.toLowerCase().includes('fetch') || raw.toLowerCase().includes('network') || raw.toLowerCase().includes('econnrefused')) {
    return { message: 'Network error. Check your internet connection.', provider };
  }

  return { message: raw, provider };
}

// ── Message handlers ──

async function handleChat(
  port: chrome.runtime.Port,
  msg: {
    agentId: string;
    message: string;
    pageContext?: { title: string; url: string; content: string };
  },
): Promise<void> {
  port.postMessage({ type: 'chatStart', agentId: msg.agentId });

  const abortController = new AbortController();
  activeAbortControllers.set(port, abortController);
  startKeepalive();

  try {
    const fullResponse = await runAgentLoop({
      agentId: msg.agentId,
      userMessage: msg.message,
      pageContext: msg.pageContext,
      onChunk: (chunk: string) => {
        if (abortController.signal.aborted) return;
        try {
          port.postMessage({ type: 'chatChunk', chunk, agentId: msg.agentId });
        } catch {
          // Port disconnected — abort the loop
          abortController.abort();
        }
      },
      onToolCall: (call: { name: string; args: unknown; result: unknown }) => {
        if (abortController.signal.aborted) return;
        try {
          port.postMessage({ type: 'toolCall', name: call.name, args: call.args, result: call.result, agentId: msg.agentId });
        } catch {
          // Port disconnected
          abortController.abort();
        }
      },
    });

    if (!abortController.signal.aborted) {
      port.postMessage({ type: 'chatEnd', fullResponse, agentId: msg.agentId });
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      const parsed = parseApiError(err);
      port.postMessage({
        type: 'chatError',
        error: parsed.message,
        provider: parsed.provider,
        agentId: msg.agentId,
        lastMessage: {
          agentId: msg.agentId,
          message: msg.message,
          pageContext: msg.pageContext,
        },
      });
    }
  } finally {
    activeAbortControllers.delete(port);
    stopKeepalive();
  }
}

async function handleAgenticChat(
  port: chrome.runtime.Port,
  msg: {
    agentId: string;
    message: string;
    pageContext?: { title: string; url: string; content: string };
    maxIterations?: number;
  },
): Promise<void> {
  port.postMessage({ type: 'agenticStart', agentId: msg.agentId });

  const abortController = new AbortController();
  activeAbortControllers.set(port, abortController);
  startKeepalive();

  try {
    const result = await runAgenticLoop({
      agentId: msg.agentId,
      task: msg.message,
      pageContext: msg.pageContext,
      maxIterations: msg.maxIterations,
      signal: abortController.signal,
      onProgress: (update: ProgressUpdate) => {
        if (abortController.signal.aborted) return;
        try {
          port.postMessage({
            type: 'agenticProgress',
            agentId: msg.agentId,
            progressType: update.type,
            content: update.content,
            toolName: update.toolName,
            toolArgs: update.toolArgs,
            toolResult: update.toolResult,
            iteration: update.iteration,
            totalIterations: update.totalIterations,
          });
        } catch {
          // Port disconnected
          abortController.abort();
        }
      },
    });

    if (!abortController.signal.aborted) {
      port.postMessage({ type: 'agenticDone', result, agentId: msg.agentId });
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      const parsed = parseApiError(err);
      port.postMessage({
        type: 'chatError',
        error: parsed.message,
        provider: parsed.provider,
        agentId: msg.agentId,
        lastMessage: {
          agentId: msg.agentId,
          message: msg.message,
          pageContext: msg.pageContext,
        },
      });
    }
  } finally {
    activeAbortControllers.delete(port);
    stopKeepalive();
  }
}

async function handleExtractContent(port: chrome.runtime.Port): Promise<void> {
  try {
    // Check we have the needed permissions
    const hasScripting = await chrome.permissions.contains({
      permissions: ['scripting'],
      origins: ['<all_urls>'],
    });

    if (!hasScripting) {
      port.postMessage({
        type: 'extractedContent',
        content: null,
        error: 'Permission needed: enable "Read page content" in CHAOS settings to use this feature.',
        needsPermission: 'scripting',
      });
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      port.postMessage({
        type: 'extractedContent',
        content: null,
        error: 'No active tab found',
      });
      return;
    }

    // Try sending message first (script may already be injected)
    let response: unknown;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: 'extractContent',
      });
    } catch {
      // Content script not injected yet - inject dynamically
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/content/extractor.js'],
        });
        // Retry after injection
        await new Promise((r) => setTimeout(r, 200));
        response = await chrome.tabs.sendMessage(tab.id, {
          type: 'extractContent',
        });
      } catch (injectErr) {
        port.postMessage({
          type: 'extractedContent',
          content: null,
          error: `Cannot read this page: ${injectErr instanceof Error ? injectErr.message : String(injectErr)}`,
        });
        return;
      }
    }

    port.postMessage({
      type: 'extractedContent',
      content: response,
    });
  } catch (err) {
    port.postMessage({
      type: 'extractedContent',
      content: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleListAgents(port: chrome.runtime.Port): Promise<void> {
  const agents = await listAgents();
  port.postMessage({ type: 'agentList', agents });
}

async function handleCreateAgent(
  port: chrome.runtime.Port,
  msg: { name: string; role: string; visibility?: string },
): Promise<void> {
  const agent = await createAgent(msg.name, msg.role);
  if (msg.visibility && msg.visibility !== 'private') {
    await updateAgentMeta(agent.id, { visibility: msg.visibility as 'private' | 'visible' | 'open' });
    agent.visibility = msg.visibility as 'private' | 'visible' | 'open';
  }
  // Set up daily review scheduled task
  try {
    const alarmName = `${agent.id}:daily-review`;
    chrome.alarms.create(alarmName, {
      delayInMinutes: 60, // First run in 1 hour
      periodInMinutes: 1440, // Then every 24 hours
    });
    await addScheduledTask({
      alarmId: alarmName,
      agentId: agent.id,
      prompt: `Daily review: Read through your memories/, activity-log.jsonl, TODO.md, and any pending messages. Look for patterns: stale TODOs (older than a week), repeated topics without action, and ignored suggestions. Write a brief daily review to memories/daily-reviews/ with today's date. Include: what happened recently, what's pending, and 1-3 proactive suggestions for things you could help with. If you have suggestions, note them so you can mention them in the next conversation.`,
      description: 'Daily review and proactive insights',
      createdAt: new Date().toISOString(),
      schedule: { type: 'recurring', periodInMinutes: 1440 },
    });
  } catch (err) {
    console.warn('Failed to set up daily review:', err);
  }

  await refreshContextMenus();
  port.postMessage({ type: 'agentCreated', agent });
}

async function handleDeleteAgent(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  await deleteAgent(msg.agentId);
  await refreshContextMenus();
  port.postMessage({ type: 'agentDeleted', agentId: msg.agentId });
}

async function handleGetApiKeys(port: chrome.runtime.Port): Promise<void> {
  const keys = await getApiKeys();
  port.postMessage({ type: 'apiKeys', keys });
}

async function handleSetApiKeys(
  port: chrome.runtime.Port,
  msg: { keys: Record<string, string> },
): Promise<void> {
  await setApiKeys(msg.keys);
  port.postMessage({ type: 'apiKeysSaved' });
}

// ── Settings handlers ──

async function handleGetSettings(port: chrome.runtime.Port): Promise<void> {
  const { getSettings } = await import('./storage/chrome-storage.js');
  const settings = await getSettings();
  port.postMessage({ type: 'settings', settings });
}

async function handleSetSettings(
  port: chrome.runtime.Port,
  msg: { settings: Record<string, unknown> },
): Promise<void> {
  const { getSettings, setSettings } = await import('./storage/chrome-storage.js');
  const current = await getSettings();
  await setSettings({ ...current, ...msg.settings });
  port.postMessage({ type: 'settingsSaved' });
}

// ── Conversation persistence handlers ──

async function handleSaveConversation(
  port: chrome.runtime.Port,
  msg: { agentId: string; messages: ConversationMessage[] },
): Promise<void> {
  const conv: Conversation = {
    id: msg.agentId, // One conversation per agent (keyed by agentId)
    agentId: msg.agentId,
    timestamp: new Date().toISOString(),
    messages: msg.messages,
  };
  await setConversation(conv);
  port.postMessage({ type: 'conversationSaved', agentId: msg.agentId });
}

async function handleGetConversation(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  const conv = await getConversation(msg.agentId);
  port.postMessage({
    type: 'conversationLoaded',
    agentId: msg.agentId,
    messages: conv?.messages ?? [],
  });
}

async function handleClearConversation(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  await deleteConversation(msg.agentId);
  port.postMessage({ type: 'conversationCleared', agentId: msg.agentId });
}

// ── Port handlers for side panel agents/files tabs ──

async function handleGetAgentDetail(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  const { meta, claudeMd } = await getAgent(msg.agentId);
  port.postMessage({ type: 'agentDetail', agentId: meta.id, claudeMd });
}

async function handleListAgentFilesPort(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  const basePath = `agents/${msg.agentId}`;
  const files = await listOPFSDir(basePath);
  port.postMessage({ type: 'agentFiles', agentId: msg.agentId, files });
}

async function handleReadAgentFilePort(
  port: chrome.runtime.Port,
  msg: { agentId: string; path: string },
): Promise<void> {
  const fullPath = `agents/${msg.agentId}/${msg.path}`;
  try {
    const content = await opfs.readFile(fullPath);
    port.postMessage({ type: 'agentFileContent', path: msg.path, content });
  } catch {
    port.postMessage({ type: 'agentFileContent', path: msg.path, content: '(File not found or unreadable)' });
  }
}

async function handleUpdateAgentVisibilityPort(
  port: chrome.runtime.Port,
  msg: { agentId: string; visibility: string },
): Promise<void> {
  await updateAgentMeta(msg.agentId, {
    visibility: msg.visibility as 'private' | 'visible' | 'open',
  });
  port.postMessage({ type: 'agentVisibilityUpdated', agentId: msg.agentId });
}

async function handleUpdateAgentClaudeMdPort(
  port: chrome.runtime.Port,
  msg: { agentId: string; content: string },
): Promise<void> {
  await opfs.writeFile(`agents/${msg.agentId}/CLAUDE.md`, msg.content);
  port.postMessage({ type: 'claudeMdUpdated', agentId: msg.agentId });
}

// ── Hooks port handlers ──

async function handleGetHooks(
  port: chrome.runtime.Port,
  msg: { agentId?: string },
): Promise<void> {
  const hooks = await getHooks();
  const filtered = msg.agentId ? hooks.filter((h) => h.agentId === msg.agentId) : hooks;
  port.postMessage({ type: 'hooksList', hooks: filtered });
}

async function handleAddHook(
  port: chrome.runtime.Port,
  msg: { hook: import('./storage/types.js').Hook },
): Promise<void> {
  await addHook(msg.hook);
  await refreshContextMenus();
  port.postMessage({ type: 'hookAdded', hook: msg.hook });
}

async function handleUpdateHookPort(
  port: chrome.runtime.Port,
  msg: { hookId: string; updates: Partial<import('./storage/types.js').Hook> },
): Promise<void> {
  await updateHook(msg.hookId, msg.updates);
  await refreshContextMenus();
  port.postMessage({ type: 'hookUpdated', hookId: msg.hookId });
}

async function handleRemoveHook(
  port: chrome.runtime.Port,
  msg: { hookId: string },
): Promise<void> {
  await removeHook(msg.hookId);
  await refreshContextMenus();
  port.postMessage({ type: 'hookRemoved', hookId: msg.hookId });
}

// ── One-shot message handling (for dashboard and popup) ──

chrome.runtime.onMessage.addListener(
  (msg: Record<string, unknown>, _sender, sendResponse) => {
    handleOneShotMessage(msg)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });
    return true; // keep the message channel open for async response
  },
);

async function handleOneShotMessage(
  msg: Record<string, unknown>,
): Promise<unknown> {
  switch (msg.type) {
    case 'listAgents': {
      const agents = await listAgents();
      return { agents };
    }

    case 'createAgent': {
      const agent = await createAgent(msg.name as string, msg.role as string);
      await refreshContextMenus();
      return { agent };
    }

    case 'deleteAgent': {
      await deleteAgent(msg.agentId as string);
      await refreshContextMenus();
      return { deleted: true };
    }

    case 'getAgentDetail': {
      const agentId = msg.agentId as string;
      const { meta, claudeMd } = await getAgent(agentId);

      // Read recent journal entries (last 10 lines from activity-log.jsonl)
      let journal: string[] = [];
      try {
        journal = await opfs.readLines(`agents/${agentId}/activity-log.jsonl`, 10);
      } catch {
        // File may not exist yet
      }

      // Read bookmarks folder contents (bookmark titles)
      let bookmarks: string[] = [];
      if (meta.bookmarkFolderId) {
        try {
          const children = await chrome.bookmarks.getChildren(meta.bookmarkFolderId);
          bookmarks = children.map((b) => b.title + (b.url ? ` — ${b.url}` : ''));
        } catch {
          // Folder may not exist
        }
      }

      return { meta, claudeMd, journal, bookmarks };
    }

    case 'updateAgentVisibility': {
      await updateAgentMeta(msg.agentId as string, {
        visibility: msg.visibility as 'private' | 'visible' | 'open',
      });
      return { updated: true };
    }

    case 'updateAgentTools': {
      const updates: Partial<{ enabledTools: string[]; disabledTools: string[] }> = {};
      if (msg.enabledTools !== undefined) {
        updates.enabledTools = msg.enabledTools as string[] | undefined;
      }
      if (msg.disabledTools !== undefined) {
        updates.disabledTools = msg.disabledTools as string[] | undefined;
      }
      await updateAgentMeta(msg.agentId as string, updates);
      return { updated: true };
    }

    case 'getMessages': {
      const messages = await getMessages();
      return { messages };
    }

    case 'getTaskState': {
      const tasks = await getTaskState();
      return { tasks };
    }

    case 'getArtifacts': {
      const artifacts = await listArtifacts();
      return { artifacts };
    }

    case 'readArtifactContent': {
      try {
        const content = await opfs.readFile(msg.path as string);
        return { content };
      } catch {
        return { content: '(File not found or unreadable)' };
      }
    }

    case 'getApiKeys': {
      const keys = await getApiKeys();
      return { keys };
    }

    case 'setApiKeys': {
      await setApiKeys(msg.keys as Record<string, string>);
      return { saved: true };
    }

    case 'getSettings': {
      const { getSettings: getSettingsSync } = await import('./storage/chrome-storage.js');
      const settings = await getSettingsSync();
      return { settings };
    }

    case 'setSettings': {
      const { getSettings: getSettingsSync2, setSettings: setSettingsSync } = await import('./storage/chrome-storage.js');
      const current = await getSettingsSync2();
      await setSettingsSync({ ...current, ...msg.settings as Record<string, unknown> });
      return { saved: true };
    }

    case 'listAgentFiles': {
      const agentId = msg.agentId as string;
      const basePath = `agents/${agentId}`;
      const files = await listOPFSDir(basePath);
      return { files };
    }

    case 'readAgentFile': {
      const agentId = msg.agentId as string;
      const filePath = msg.path as string;
      // Ensure the path is within the agent's directory for safety
      const fullPath = `agents/${agentId}/${filePath}`;
      try {
        const content = await opfs.readFile(fullPath);
        return { content };
      } catch {
        return { content: '(File not found or unreadable)' };
      }
    }

    case 'getScheduledTasks': {
      const { getScheduledTasks: getTasks } = await import('./storage/chrome-storage.js');
      const scheduledTasks = await getTasks();
      return { tasks: scheduledTasks };
    }

    case 'cancelScheduledTask': {
      const alarmId = msg.alarmId as string;
      await chrome.alarms.clear(alarmId);
      await removeScheduledTask(alarmId);
      return { cancelled: true };
    }

    case 'runScheduledTask': {
      const alarmId = msg.alarmId as string;
      const allTasks = await getScheduledTasks();
      const task = allTasks.find((t) => t.alarmId === alarmId);
      if (!task) return { error: 'Task not found' };
      const result = await runAgenticLoop({
        agentId: task.agentId,
        task: task.prompt,
      });
      await updateScheduledTaskRun(task.alarmId, result || '(no output)');
      return { ran: true, result: (result || '').slice(0, 200) };
    }

    case 'updateScheduledTaskRun': {
      const runAlarmId = msg.alarmId as string;
      const runResult = msg.result as string;
      await updateScheduledTaskRun(runAlarmId, runResult || '(no output)');
      return { updated: true };
    }

    case 'openDashboard': {
      await openOrFocusChaosTab();
      return { opened: true };
    }

    case 'refinePrompt': {
      try {
        const rawPrompt = msg.prompt as string;
        const context = msg.context as string || '';

        const { getSettings, getApiKeys: getKeys } = await import('./storage/chrome-storage.js');
        const settings = await getSettings();
        const keys = await getKeys();
        const provider = settings.activeProvider as keyof typeof keys;
        const apiKey = keys[provider];
        if (!apiKey) return { error: `No API key configured for ${settings.activeProvider}. Add one in Global Settings.` };

        const { createLanguageModel } = await import('./agents/provider-registry.js');
        const { generateText } = await import('ai');
        const model = createLanguageModel(settings.activeProvider, apiKey, settings.model);

        const result = await generateText({
          model,
          system: `You are a prompt refinement assistant. The user has written a rough prompt for an AI agent task. Your job is to improve it by:
- Making it more specific and actionable
- Adding clear step-by-step instructions
- Specifying what tools the agent should use (e.g. tab_read, fetch_page, write_file)
- Specifying where to save output (e.g. memories/, TODO.md)
- Adding error handling guidance (what to do if something fails)
- Keeping the user's intent intact

Return ONLY the refined prompt text, nothing else. No explanations or commentary.`,
          prompt: `Context: ${context}\n\nOriginal prompt:\n${rawPrompt}`,
        });

        return { refined: result.text };
      } catch (err) {
        console.error('refinePrompt failed:', err);
        return { error: `Refinement failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    default:
      throw new Error(`Unknown one-shot message type: ${msg.type}`);
  }
}

// ── Global hotkey for voice input ──

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-voice') return;

  // Find the active NTP tab and send a toggle message
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const ntpTab = tabs.find((t) => t.url?.startsWith('chrome-extension://') && t.url?.includes('app.html'));
  if (ntpTab?.id) {
    chrome.tabs.sendMessage(ntpTab.id, { type: 'toggle-voice-input' });
  }
});

// ── Alarm handling for scheduled agent wake-ups ──

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Ignore keepalive alarm — it only exists to prevent SW termination
  if (alarm.name === 'chaos-keepalive') return;

  console.log(`Alarm fired: ${alarm.name}`);

  try {
    // Look up a scheduled task for this alarm
    const tasks = await getScheduledTasks();
    const task = tasks.find((t) => t.alarmId === alarm.name);

    if (alarm.name.startsWith('agentic:')) {
      // Master-assigned task trigger: agentic:{agentId}:{taskId}
      const parts = alarm.name.split(':');
      const agentId = parts[1];
      const taskId = parts.slice(2).join(':');
      console.log(`Master-assigned task alarm: agent=${agentId}, task=${taskId}`);

      // Look up the task to get its prompt
      const { getTaskState: getSharedTaskState } = await import('./storage/shared.js');
      const sharedTasks = await getSharedTaskState();
      const assignedTask = sharedTasks.find((t) => t.id === taskId);
      const prompt = assignedTask?.description || 'You have been assigned a task. Check the shared task board for details.';

      startKeepalive();
      try {
        await runAgenticLoop({
          agentId,
          task: prompt,
        });
      } finally {
        stopKeepalive();
      }
    } else if (task) {
      // Run a full agentic loop with the stored prompt (multi-step autonomous)
      const result = await runAgenticLoop({
        agentId: task.agentId,
        task: task.prompt,
      });

      // Update the task with run info
      await updateScheduledTaskRun(task.alarmId, result || '(no output)');

      // If this was a one-shot alarm, clean up the task
      if (task.schedule.type === 'once') {
        await removeScheduledTask(task.alarmId);
      }

      console.log(`Scheduled task completed for alarm: ${alarm.name}`);
    } else {
      // Legacy fallback: alarm names following the pattern agentId:name
      // Extract agentId from the alarm name (before the first colon)
      const colonIdx = alarm.name.indexOf(':');
      if (colonIdx > 0) {
        const agentId = alarm.name.slice(0, colonIdx);
        await runAgenticLoop({
          agentId,
          task: 'You were woken up by a scheduled alarm. Check your TODO list and pending messages, then do any work that needs doing.',
        });
      } else {
        console.warn(`Unknown alarm with no scheduled task: ${alarm.name}`);
      }
    }
  } catch (err) {
    console.error(`Alarm handler failed for ${alarm.name}:`, err);
  }
});

// ── Bookmark watcher ──
// Only register if bookmarks permission is available
// (listener registration itself is safe even without permission,
//  but the API calls inside will fail if not granted)

chrome.bookmarks?.onCreated?.addListener(async (_id, bookmark) => {
  // Only care about actual bookmarks (with URLs), not folders
  if (!bookmark.url || !bookmark.parentId) return;

  try {
    // Check if this bookmark is in any agent's CHAOS folder
    const agents = await listAgents();
    let matchingAgent: { id: string; name: string } | null = null;

    for (const agent of agents) {
      if (!agent.bookmarkFolderId) continue;
      if (bookmark.parentId === agent.bookmarkFolderId) {
        matchingAgent = agent;
        break;
      }
    }

    if (!matchingAgent) return;

    console.log(
      `Bookmark added to agent "${matchingAgent.name}": ${bookmark.title} — ${bookmark.url}`,
    );

    // Fetch page content
    let content = '';
    let title = bookmark.title || '';

    try {
      // Try fetching the page directly
      const response = await fetch(bookmark.url);
      if (response.ok) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        title = doc.querySelector('title')?.textContent?.trim() || title;

        // Remove non-content elements
        for (const sel of ['script', 'style', 'nav', 'footer', 'noscript', 'svg', 'iframe']) {
          doc.querySelectorAll(sel).forEach((el) => el.remove());
        }

        const mainEl =
          doc.querySelector('main') ??
          doc.querySelector('article') ??
          doc.querySelector('[role="main"]') ??
          doc.body;

        content = mainEl?.textContent?.trim() ?? '';

        // Truncate long content
        if (content.length > 10000) {
          content = content.slice(0, 10000) + '\n\n[Content truncated]';
        }
      }
    } catch {
      content = `(Could not fetch content from ${bookmark.url})`;
    }

    // Save to agent's bookmarks/ OPFS directory
    const safeTitle = (title || 'untitled')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80);
    const filePath = `agents/${matchingAgent.id}/bookmarks/${safeTitle}.md`;
    const markdown = `# ${title}\n\n- **URL:** ${bookmark.url}\n- **Bookmarked:** ${new Date().toISOString()}\n\n## Content\n\n${content}`;

    await opfs.writeFile(filePath, markdown);

    // Log in activity journal
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      role: 'system' as const,
      summary: `Bookmark added: "${title}" — ${bookmark.url}`,
    });
    await opfs.appendFile(
      `agents/${matchingAgent.id}/activity-log.jsonl`,
      logEntry + '\n',
    );

    console.log(`Saved bookmark content to ${filePath}`);
  } catch (err) {
    console.error('Bookmark watcher error:', err);
  }
});
