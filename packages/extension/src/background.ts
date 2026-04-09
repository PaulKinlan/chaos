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

// Polyfill: some AI SDK dependencies reference `window` which doesn't exist in service workers
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
}

import {
  createAgent,
  listAgents,
  deleteAgent,
  getAgent,
  updateAgentMeta,
} from './agents/manager.js';
import { createExtensionAgent, mapProgressEvent, appendActivityLog } from './agents/extension-agent.js';
import type { ProgressUpdate } from './agents/extension-agent.js';
import {
  getApiKeys,
  setApiKeys,
  getSettings,
  setSettings,
  getScheduledTasks,
  addScheduledTask,
  updateScheduledTaskRun,
  removeScheduledTask,
  getHooks,
  addHook,
  updateHook,
  removeHook,
} from './storage/chrome-storage.js';
import { generateText } from 'ai';
import { createLanguageModel } from './agents/provider-registry.js';
import { getMessages, setMessageNotifier } from './storage/shared.js';
import {
  installSkill,
  removeSkill,
  listSkills,
  parseFrontmatter,
} from './agents/skills.js';
import { fetchSkillFromUrl } from './agents/skill-fetcher.js';
import { archiveAgent, listArchivedAgents, restoreAgent } from './agents/manager.js';
import { recordUsage, getUsageSummary, getUsage, clearUsage } from './agents/usage.js';
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
import { initHooksListeners, setHookUiPortGetter } from './hooks/listener.js';
import { setTaskExecutor } from './tools/master/assign-task.js';
import {
  isChannelPollAlarm,
  handlePollAlarm,
  startChannelPolling,
  stopChannelPolling,
  startWebSocket,
  stopWebSocket,
  setMessageHandler,
  getMessageHandler,
} from './channels/poller.js';
import { getRelaySettings } from './channels/config.js';

import { ChaosSDK } from '@chaos/sdk';
import {
  ChromeAgentStore,
  ChromeSettingsStore,
  ChromeHookStore,
  ChromeUsageStore,
  OPFSMemoryStore,
  OPFSConversationStore,
} from './stores/chrome-stores.js';
import { createChromeBrowser, ChromeTaskScheduler, ChromePageParser } from './stores/chrome-browser.js';

// ── SDK instance ──

export const sdk = new ChaosSDK({
  agentStore: new ChromeAgentStore(),
  settings: new ChromeSettingsStore(),
  hooks: new ChromeHookStore(),
  usage: new ChromeUsageStore(),
  memory: new OPFSMemoryStore(),
  conversations: new OPFSConversationStore(),
  browser: createChromeBrowser(),
  scheduler: new ChromeTaskScheduler(),
  pageParser: new ChromePageParser(),
});

const DEFAULT_MAX_ITERATIONS_BG = 20;

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
  // Use wildcard to match even when the tab has a hash fragment (e.g. app.html#agent-xyz)
  const existing = await chrome.tabs.query({ url: url + '*' });
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

  // On first install, set flag for onboarding wizard
  if (details.reason === 'install') {
    await chrome.storage.local.set({ 'chaos:needs-onboarding': true });
    console.log('[background] First install — onboarding flag set');
  }

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
          prompt: 'Daily review: Read through your memories/, activity-log.jsonl, TODO.md, and any pending messages. Look for patterns: stale TODOs (older than a week), repeated topics without action, and ignored suggestions. Write a brief daily review to memories/daily-reviews/ with today\'s date. Include: what happened recently, what\'s pending, and 1-3 proactive suggestions for things you could help with. After your review, publish a \'Daily Summary\' artifact using artifact_publish with a brief markdown summary of: what happened today, what\'s pending, and 2-3 proactive suggestions for things you could help with. Title it \'Daily Summary - [date]\'. Also publish a JSON artifact at suggestions/latest.json containing an array of suggestion objects with fields: id, title, description, action (object with type: \'chat\' and prompt: string), priority (high/medium/low), createdAt.',
          description: 'Daily review, proactive insights, and summary artifacts',
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
setHookUiPortGetter(() => activeUiPort);
setTaskExecutor((agentId, taskId) => {
  executeAssignedTask(agentId, taskId).catch(
    (err) => console.error(`[background] executeAssignedTask failed:`, err),
  );
});

// Wire up inter-agent message notifications
setMessageNotifier((msg) => {
  console.log(`[background] Inter-agent message: ${msg.from} → ${msg.to}`);

  // Notify UI
  if (activeUiPort) {
    try {
      activeUiPort.postMessage({
        type: 'channelMessageReceived',
        agentId: msg.to === 'broadcast' ? msg.from : msg.to,
        channelLabel: 'Agent Message',
        from: msg.from,
        content: msg.body.slice(0, 200),
        channelType: 'agent-message',
        channelId: `msg-${msg.id}`,
      });
    } catch { /* */ }
  }

  // Wake the recipient agent (skip broadcasts — they'd wake everyone)
  if (msg.to !== 'broadcast') {
    wakeAgentForMessage(msg.to, msg.from, msg.body).catch(
      (err) => console.error(`[background] Failed to wake agent ${msg.to}:`, err),
    );
  }
});

// ── Context menus ──

async function setupContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();

  // Parent menu
  chrome.contextMenus.create({
    id: 'chaos-parent',
    title: 'Send to CHAOS agent',
    contexts: ['selection', 'page', 'link', 'image', 'video', 'audio'],
  });

  const allContexts: chrome.contextMenus.ContextType[] = ['selection', 'page', 'link', 'image', 'video', 'audio'];

  // Add child items per agent
  const agents = await listAgents();
  for (const agent of agents) {
    chrome.contextMenus.create({
      id: `chaos-agent-${agent.id}`,
      parentId: 'chaos-parent',
      title: agent.name,
      contexts: allContexts,
    });
  }

  // If no agents, show a placeholder
  if (agents.length === 0) {
    chrome.contextMenus.create({
      id: 'chaos-no-agents',
      parentId: 'chaos-parent',
      title: '(no agents created yet)',
      enabled: false,
      contexts: allContexts,
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
      contexts: allContexts,
    });
    for (const hook of contextMenuHooks) {
      const trigger = hook.trigger as Extract<import('./storage/types.js').HookTrigger, { type: 'context-menu' }>;
      chrome.contextMenus.create({
        id: `chaos-hook-${hook.id}`,
        parentId: 'chaos-parent',
        title: trigger.label || hook.description,
        contexts: allContexts,
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

  // Build rich context from all available info — always include everything
  const parts: string[] = [];

  // What was the click target?
  if (info.mediaType) {
    parts.push(`Context: Right-clicked on ${info.mediaType}`);
  } else if (info.linkUrl) {
    parts.push(`Context: Right-clicked on a link`);
  } else if (info.selectionText) {
    parts.push(`Context: Right-clicked on selected text`);
  } else {
    parts.push(`Context: Right-clicked on the page`);
  }

  // Always include page info
  if (tab?.title) {
    parts.push(`Page title: ${tab.title}`);
  }
  if (tab?.url) {
    parts.push(`Page URL: ${tab.url}`);
  }

  // Specific click target data
  if (info.linkUrl) {
    parts.push(`Link URL: ${info.linkUrl}`);
  }
  if (info.selectionText) {
    parts.push(`Selected text: ${info.selectionText}`);
  }
  if (info.srcUrl) {
    parts.push(`Media URL: ${info.srcUrl}`);
  }
  if (info.frameUrl && info.frameUrl !== tab?.url) {
    parts.push(`Frame URL: ${info.frameUrl}`);
  }

  // Try to extract page content for additional context
  // (always attempt — even with a selection or link, the page context is useful)
  if (tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'extractContent',
      });
      if (response?.content) {
        // Truncate to avoid overwhelming the prompt if there's already specific context
        const maxLen = (info.selectionText || info.linkUrl) ? 2000 : 10000;
        const pageContent = response.content.length > maxLen
          ? response.content.slice(0, maxLen) + '\n...(truncated)'
          : response.content;
        parts.push(`Page content:\n${pageContent}`);
      }
    } catch {
      // Content extraction failed (no content script), continue with what we have
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
      if (chaosTab.status === 'complete') {
        await chrome.tabs.sendMessage(chaosTab.id, messagePayload);
      } else {
        // Wait for the tab to finish loading before sending
        await new Promise<void>((resolve) => {
          const listener = (
            tabId: number,
            changeInfo: chrome.tabs.TabChangeInfo,
          ) => {
            if (tabId === chaosTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
        await chrome.tabs.sendMessage(chaosTab.id, messagePayload);
      }
    }
  } catch (err) {
    console.error('Failed to open NTP for context menu action:', err);
  }
});

// ── Active agent loop tracking (for keepalive and cancellation) ──

let activeLoopCount = 0;
const activeAbortControllers = new Map<string, AbortController>();

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

// Track the active UI port so channel messages can stream progress to the UI
let activeUiPort: chrome.runtime.Port | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chaos-ui') return;
  activeUiPort = port;

  port.onDisconnect.addListener(() => {
    if (activeUiPort === port) activeUiPort = null;
    // Do NOT abort active loops on disconnect — tab lifecycle events (navigation,
    // refresh, service-worker restart) cause spurious disconnects.  Loops will
    // continue running and post progress once the UI reconnects.  Explicit
    // cancellation is handled by the stopAgenticLoop message (sent e.g. when the
    // user closes a column via removeColumn()).
  });

  port.onMessage.addListener(async (msg) => {
    console.log(`[background] port message: ${msg.type}`);
    try {
      switch (msg.type) {
        case 'chat':
        case 'agenticChat':
          await handleAgenticChat(port, msg);
          break;

        case 'stopAgenticLoop': {
          const loopKey = (msg.columnId as string) || (msg.agentId as string) || undefined;
          if (loopKey) {
            const controller = activeAbortControllers.get(loopKey);
            if (controller) {
              controller.abort();
              activeAbortControllers.delete(loopKey);
            }
          } else {
            // No key: abort all (legacy / stop-all)
            for (const [, controller] of activeAbortControllers) {
              controller.abort();
            }
            activeAbortControllers.clear();
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

        case 'listSkills':
          await handleListSkills(port, msg);
          break;

        case 'installSkill':
          await handleInstallSkill(port, msg);
          break;

        case 'removeSkill':
          await handleRemoveSkill(port, msg);
          break;

        case 'importSkillFromUrl':
          await handleImportSkillFromUrl(port, msg);
          break;

        case 'fetchSkillPreview':
          await handleFetchSkillPreview(port, msg);
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

  // Abort any existing loop for this agent before starting a new one
  const existing = activeAbortControllers.get(msg.agentId);
  if (existing) {
    console.log(`[background] Aborting stale loop for agent ${msg.agentId}`);
    existing.abort();
  }
  const abortController = new AbortController();
  activeAbortControllers.set(msg.agentId, abortController);
  startKeepalive();

  try {
    const { agent: chatAgent, skillNames: chatSkillNames } = await createExtensionAgent(msg.agentId, {
      task: msg.message,
      pageContext: msg.pageContext,
      maxIterations: 10,
      signal: abortController.signal,
      source: 'chat',
    });

    if (chatSkillNames.length > 0) {
      try {
        port.postMessage({ type: 'chatChunk', chunk: `Loaded skills: ${chatSkillNames.join(', ')}\n\n`, agentId: msg.agentId });
      } catch { /* */ }
    }

    let fullResponse = '';
    for await (const event of chatAgent.stream(msg.message, msg.pageContext ? JSON.stringify(msg.pageContext) : undefined)) {
      if (abortController.signal.aborted) break;
      const update = mapProgressEvent(event, 10);
      if (event.type === 'thinking') {
        try {
          port.postMessage({ type: 'chatChunk', chunk: event.content, agentId: msg.agentId });
        } catch {
          abortController.abort();
        }
      } else if (event.type === 'tool-call') {
        try {
          port.postMessage({ type: 'toolCall', name: event.toolName, args: event.toolArgs, result: undefined, agentId: msg.agentId });
        } catch {
          abortController.abort();
        }
      } else if (event.type === 'tool-result') {
        try {
          port.postMessage({ type: 'toolCall', name: event.toolName, args: undefined, result: event.toolResult, agentId: msg.agentId });
        } catch {
          abortController.abort();
        }
      } else if (event.type === 'done' || event.type === 'text') {
        fullResponse = event.content;
      }
    }

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
    // Only delete if this is still our controller (not replaced by a newer request)
    if (activeAbortControllers.get(msg.agentId) === abortController) {
      activeAbortControllers.delete(msg.agentId);
    }
    stopKeepalive();
  }
}

/** Wake an agent to process a new inter-agent message. */
async function wakeAgentForMessage(agentId: string, fromAgentId: string, body: string): Promise<void> {
  console.log(`[background] Waking agent ${agentId} for message from ${fromAgentId}`);

  const agents = await listAgents();
  const sender = agents.find(a => a.id === fromAgentId);
  const senderName = sender?.name || fromAgentId;

  if (activeUiPort) {
    try { activeUiPort.postMessage({ type: 'agenticStart', agentId }); } catch { /* */ }
  }

  const messageTask = `You received a message from another agent.\n\nFrom: ${senderName}\nMessage: ${body}\n\nProcess this message and take any appropriate action. If the message reports task completion, review the results. If it asks you to do something, do it.`;

  startKeepalive();
  try {
    const { agent: msgAgent } = await createExtensionAgent(agentId, {
      task: messageTask,
      source: 'message',
    });

    let result = '';
    for await (const event of msgAgent.stream(messageTask)) {
      const update = mapProgressEvent(event, DEFAULT_MAX_ITERATIONS_BG);
      if (!activeUiPort) continue;
      try {
        activeUiPort.postMessage({
          type: 'agenticProgress',
          agentId,
          progressType: update.type,
          content: update.content,
          toolName: update.toolName,
          toolArgs: update.toolArgs,
          toolResult: update.toolResult,
          iteration: update.iteration,
          totalIterations: update.totalIterations,
        });
      } catch { /* */ }
      if (event.type === 'done' || event.type === 'text') {
        result = event.content;
      }
    }

    if (activeUiPort) {
      try { activeUiPort.postMessage({ type: 'agenticDone', result, agentId }); } catch { /* */ }
    }
  } catch (err) {
    console.error(`[background] Agent ${agentId} message processing failed:`, err);
  } finally {
    stopKeepalive();
  }
}

/** Execute an assigned task: update status, stream to UI, mark complete/failed. */
async function executeAssignedTask(agentId: string, taskId: string): Promise<void> {
  console.log(`[background] Executing assigned task: agent=${agentId}, task=${taskId}`);

  const { getTaskState: getSharedTaskState, appendTaskEvent: appendEvent } = await import('./storage/shared.js');
  const sharedTasks = await getSharedTaskState();
  const assignedTask = sharedTasks.find((t) => t.id === taskId);
  const prompt = assignedTask?.description || 'You have been assigned a task. Check the shared task board for details.';
  const taskSubject = assignedTask?.subject || 'Assigned task';

  // Mark task as in_progress
  await appendEvent({
    taskId,
    type: 'status_changed',
    timestamp: new Date().toISOString(),
    data: { status: 'in_progress' },
  });

  // Notify UI — use activeUiPort directly (not captured) so it survives reconnects
  if (activeUiPort) {
    try {
      activeUiPort.postMessage({
        type: 'channelMessageReceived',
        agentId,
        channelLabel: 'Task',
        from: taskSubject,
        content: prompt,
        channelType: 'task',
        channelId: taskId,
      });
      activeUiPort.postMessage({ type: 'agenticStart', agentId });
    } catch { /* port disconnected */ }
  }

  const assignedTaskPrompt = `You have been assigned a task.\n\nTask: ${taskSubject}\n\nInstructions:\n${prompt}\n\nWhen done, summarize what you accomplished.`;

  startKeepalive();
  try {
    const { agent: taskAgent } = await createExtensionAgent(agentId, {
      task: assignedTaskPrompt,
      source: 'task',
    });

    let result = '';
    for await (const event of taskAgent.stream(assignedTaskPrompt)) {
      const update = mapProgressEvent(event, DEFAULT_MAX_ITERATIONS_BG);
      // Always use activeUiPort (not a captured reference) so progress
      // continues flowing even if the port reconnects during execution
      if (!activeUiPort) continue;
      try {
        activeUiPort.postMessage({
          type: 'agenticProgress',
          agentId,
          progressType: update.type,
          content: update.content,
          toolName: update.toolName,
          toolArgs: update.toolArgs,
          toolResult: update.toolResult,
          iteration: update.iteration,
          totalIterations: update.totalIterations,
        });
      } catch { /* */ }
      if (event.type === 'done' || event.type === 'text') {
        result = event.content;
      }
    }

    await appendEvent({
      taskId,
      type: 'status_changed',
      timestamp: new Date().toISOString(),
      data: { status: 'completed', result: result?.slice(0, 500) || 'Task completed' },
    });

    if (activeUiPort) {
      try { activeUiPort.postMessage({ type: 'agenticDone', result, agentId }); } catch { /* */ }
    }

    // Send result back to whoever created/assigned the task
    try {
      const { appendMessage } = await import('./storage/shared.js');
      // The task's creator is tracked — find who assigned it by looking at the task events
      // For now, reply to the master agent (most common case) or the task assigner
      const agents = await listAgents();
      const master = agents.find(a => a.master);
      // Send to the agent that created the task (createdBy on the agent meta, or master)
      const { meta: selfMeta } = await getAgent(agentId);
      const replyTo = selfMeta.createdBy || master?.id;
      if (replyTo) {
        await appendMessage({
          id: crypto.randomUUID(),
          from: agentId,
          to: replyTo,
          body: `Task "${taskSubject}" completed.\n\nResult: ${result?.slice(0, 500) || 'Done'}`,
          timestamp: new Date().toISOString(),
        });
        console.log(`[background] Sent completion message from ${agentId} to ${replyTo}`);
      }
    } catch (err) {
      console.error('[background] Failed to send completion message:', err);
    }

    console.log(`[background] Task ${taskId} completed by agent ${agentId}`);
  } catch (err) {
    await appendEvent({
      taskId,
      type: 'status_changed',
      timestamp: new Date().toISOString(),
      data: { status: 'failed', result: err instanceof Error ? err.message : String(err) },
    });
    console.error(`[background] Task ${taskId} failed:`, err);
  } finally {
    stopKeepalive();
  }
}

async function handleAgenticChat(
  port: chrome.runtime.Port,
  msg: {
    agentId: string;
    message: string;
    columnId?: string;
    pageContext?: { title: string; url: string; content: string };
    maxIterations?: number;
  },
): Promise<void> {
  // Use columnId as the loop key to support multiple concurrent loops per agent
  const loopKey = (msg.columnId as string) || msg.agentId;
  console.log(`[background] handleAgenticChat: agentId=${msg.agentId}, loopKey=${loopKey}, message=${msg.message.slice(0, 80)}...`);
  // Use activeUiPort directly (not the captured port) so messages survive port reconnects
  try { activeUiPort?.postMessage({ type: 'agenticStart', agentId: msg.agentId, columnId: msg.columnId }); } catch { /* */ }

  // Abort any existing loop for this column before starting a new one
  const existing = activeAbortControllers.get(loopKey);
  if (existing) {
    console.log(`[background] Aborting stale loop for ${loopKey}`);
    existing.abort();
  }
  const abortController = new AbortController();
  activeAbortControllers.set(loopKey, abortController);
  startKeepalive();

  try {
    console.log(`[background] Starting createExtensionAgent for ${msg.agentId}`);
    const agenticMaxIter = msg.maxIterations ?? DEFAULT_MAX_ITERATIONS_BG;
    const { agent: agenticAgent, skillNames: agenticSkillNames } = await createExtensionAgent(msg.agentId, {
      task: msg.message,
      pageContext: msg.pageContext,
      maxIterations: agenticMaxIter,
      signal: abortController.signal,
      source: 'chat',
    });

    // Report loaded skills
    if (agenticSkillNames.length > 0) {
      try {
        activeUiPort?.postMessage({
          type: 'agenticProgress',
          agentId: msg.agentId,
          columnId: msg.columnId,
          progressType: 'thinking',
          content: `Loaded skills: ${agenticSkillNames.join(', ')}`,
          iteration: 0,
          totalIterations: agenticMaxIter,
        });
      } catch { /* */ }
    }

    let result = '';
    for await (const event of agenticAgent.stream(msg.message, msg.pageContext ? JSON.stringify(msg.pageContext) : undefined)) {
      if (abortController.signal.aborted) break;
      const update = mapProgressEvent(event, agenticMaxIter);
      // Use activeUiPort directly — captured port goes stale on reconnect
      if (!activeUiPort) continue;
      try {
        activeUiPort.postMessage({
          type: 'agenticProgress',
          agentId: msg.agentId,
          columnId: msg.columnId,
          progressType: update.type,
          content: update.content,
          toolName: update.toolName,
          toolArgs: update.toolArgs,
          toolResult: update.toolResult,
          iteration: update.iteration,
          totalIterations: update.totalIterations,
        });
      } catch {
        // Port disconnected — don't abort, UI may reconnect
      }
      if (event.type === 'done' || event.type === 'text') {
        result = event.content;
      }
    }

    console.log(`[background] agent loop completed for ${msg.agentId}, result length: ${result?.length ?? 0}`);
    if (!abortController.signal.aborted) {
      try { activeUiPort?.postMessage({ type: 'agenticDone', result, agentId: msg.agentId, columnId: msg.columnId }); } catch { /* */ }
    }
  } catch (err) {
    console.error(`[background] handleAgenticChat error for ${msg.agentId}:`, err);
    if (!abortController.signal.aborted) {
      const parsed = parseApiError(err);
      try {
        activeUiPort?.postMessage({
          type: 'chatError',
          error: parsed.message,
          provider: parsed.provider,
          agentId: msg.agentId,
          columnId: msg.columnId,
          lastMessage: {
            agentId: msg.agentId,
            message: msg.message,
            pageContext: msg.pageContext,
          },
        });
      } catch { /* */ }
    }
  } finally {
    // Only delete if this is still our controller (not replaced by a newer request)
    if (activeAbortControllers.get(loopKey) === abortController) {
      activeAbortControllers.delete(loopKey);
    }
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
      prompt: `Daily review: Read through your memories/, activity-log.jsonl, TODO.md, and any pending messages. Look for patterns: stale TODOs (older than a week), repeated topics without action, and ignored suggestions. Write a brief daily review to memories/daily-reviews/ with today's date. Include: what happened recently, what's pending, and 1-3 proactive suggestions for things you could help with. If you have suggestions, note them so you can mention them in the next conversation. After your review, publish a 'Daily Summary' artifact using artifact_publish with a brief markdown summary of: what happened today, what's pending, and 2-3 proactive suggestions for things you could help with. Title it 'Daily Summary - [date]'. Also publish a JSON artifact at suggestions/latest.json containing an array of suggestion objects with fields: id, title, description, action (object with type: 'chat' and prompt: string), priority (high/medium/low), createdAt.`,
      description: 'Daily review, proactive insights, and summary artifacts',
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

// ── Skills port handlers ──

async function handleListSkills(
  port: chrome.runtime.Port,
  msg: { agentId: string },
): Promise<void> {
  const skills = await listSkills(msg.agentId);
  port.postMessage({ type: 'skillsList', agentId: msg.agentId, skills });
}

async function handleInstallSkill(
  port: chrome.runtime.Port,
  msg: { agentId: string; name: string; description: string; content: string; referenceFiles?: Record<string, string> },
): Promise<void> {
  const { meta: fmMeta } = parseFrontmatter(msg.content);
  const files = new Map<string, string>();
  files.set('SKILL.md', msg.content);
  if (msg.referenceFiles) {
    for (const [path, content] of Object.entries(msg.referenceFiles)) {
      files.set(path, content);
    }
  }
  const skillId = await installSkill(
    msg.agentId,
    {
      name: fmMeta.name || msg.name,
      description: fmMeta.description || msg.description,
      author: fmMeta.author,
      version: fmMeta.version,
    },
    files,
  );
  port.postMessage({ type: 'skillInstalled', agentId: msg.agentId, skillId });
}

async function handleRemoveSkill(
  port: chrome.runtime.Port,
  msg: { agentId: string; skillId: string },
): Promise<void> {
  await removeSkill(msg.agentId, msg.skillId);
  port.postMessage({ type: 'skillRemoved', agentId: msg.agentId, skillId: msg.skillId });
}

async function handleImportSkillFromUrl(
  port: chrome.runtime.Port,
  msg: { agentId: string; url: string },
): Promise<void> {
  try {
    // Use the skill-fetcher which supports GitHub API, reference files, etc.
    const fetched = await fetchSkillFromUrl(msg.url);

    const skillId = await installSkill(
      msg.agentId,
      {
        name: fetched.meta.name,
        description: fetched.meta.description,
        author: fetched.meta.author,
        version: fetched.meta.version,
        source: msg.url,
      },
      fetched.files,
    );

    port.postMessage({
      type: 'skillImported',
      agentId: msg.agentId,
      skillId,
      meta: fetched.meta,
      fileCount: fetched.files.size,
    });
  } catch (err) {
    port.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleFetchSkillPreview(
  port: chrome.runtime.Port,
  msg: { url: string },
): Promise<void> {
  try {
    const fetched = await fetchSkillFromUrl(msg.url);
    const skillContent = fetched.files.get('SKILL.md') || '';
    const preview = skillContent.length > 2000 ? skillContent.slice(0, 2000) + '\n...' : skillContent;

    port.postMessage({
      type: 'skillPreview',
      meta: fetched.meta,
      preview,
      fileCount: fetched.files.size,
      files: Array.from(fetched.files.keys()),
    });
  } catch (err) {
    port.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
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
    const msgType = msg.type as string;
    // Skip messages handled by other listeners
    if (msgType === 'filesystemChanged' || msgType === 'channelLog') {
      return false; // Not ours
    }
    // Handle filesystem channel inbound events (from app page FileSystemObserver)
    if (msgType === 'fsChannelEvent') {
      // Route as a channel message through the message handler
      (async () => {
        try {
          const handler = getMessageHandler();
          if (!handler) return;
          const channelMessage: import('./channels/types.js').ChannelMessage = {
            id: `fs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            channelType: 'filesystem',
            channelId: msg.channelId as string,
            from: 'filesystem',
            content: `File system change detected: ${msg.changeType} — ${msg.path} (in ${msg.directory})`,
            timestamp: new Date().toISOString(),
            metadata: {
              changeType: msg.changeType,
              path: msg.path,
              directory: msg.directory,
              channelDirection: 'bidirectional',
            },
          };
          await handler(channelMessage);
        } catch (err) {
          console.error('[fs-channel] Failed to process filesystem event:', err);
        }
      })();
      return false;
    }
    // Forward filesystem channel operations to the app page (pass-through)
    if (msgType === 'fsChannelOperation') {
      return false; // Handled by the app page listener
    }
    // Handle assigned task execution (fire-and-forget, no response needed)
    if (msgType === 'executeAssignedTask') {
      executeAssignedTask(msg.agentId as string, msg.taskId as string);
      return false;
    }
    // interAgentMessage now handled via setMessageNotifier (direct callback)
    if (msgType === 'interAgentMessage') {
      return false; // Already handled
    }
    // Forward sub-agent creation to UI so it opens a column
    if (msgType === 'subAgentCreated' && activeUiPort) {
      const uiPort = activeUiPort;
      try {
        uiPort.postMessage({
          type: 'channelMessageReceived',
          agentId: msg.agentId as string,
          channelLabel: 'New Agent',
          from: msg.name as string,
          content: `Sub-agent "${msg.name}" (${msg.role}) created. Waiting for tasks...`,
          channelType: 'agent',
          channelId: msg.agentId as string,
        });
        // Refresh agent list so sidebar updates
        listAgents().then(agents => {
          try { uiPort.postMessage({ type: 'agentList', agents }); } catch { /* */ }
        });
      } catch { /* */ }
      return false;
    }
    console.log(`[background] one-shot message: ${msgType}`);
    handleOneShotMessage(msg)
      .then((result) => {
        console.log(`[background] one-shot response: ${msgType}`, result ? 'ok' : 'empty');
        sendResponse(result);
      })
      .catch((err) => {
        console.error(`[background] one-shot error: ${msgType}`, err);
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
      let meta, claudeMd;
      try {
        const result = await getAgent(agentId);
        meta = result.meta;
        claudeMd = result.claudeMd;
      } catch (err) {
        console.error('[background] getAgentDetail failed:', agentId, err);
        return { meta: null, claudeMd: '', journal: [], bookmarks: [] };
      }

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

    case 'setClaudeMd': {
      const agentId = msg.agentId as string;
      const content = msg.content as string;
      await opfs.writeFile(`agents/${agentId}/CLAUDE.md`, content);
      console.log(`[background] CLAUDE.md saved for agent ${agentId}`);
      return { ok: true };
    }

    case 'updateAgentName': {
      await updateAgentMeta(msg.agentId as string, {
        name: msg.name as string,
      });
      console.log(`[background] Agent renamed: ${msg.agentId} → ${msg.name}`);
      return { updated: true };
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

    case 'updateAgentModel': {
      const modelUpdates: Partial<{ provider?: string; model?: string }> = {};
      // Allow clearing overrides by passing undefined/empty
      modelUpdates.provider = (msg.provider as string | undefined) || undefined;
      modelUpdates.model = (msg.model as string | undefined) || undefined;
      await updateAgentMeta(msg.agentId as string, modelUpdates as Partial<import('./storage/types.js').AgentMeta>);
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

    case 'getTaskEvents': {
      const { getTaskEvents } = await import('./storage/shared.js');
      const events = await getTaskEvents();
      return { events };
    }

    case 'getArtifacts': {
      const artifacts = await listArtifacts();
      return { artifacts };
    }

    case 'getHooks': {
      const hooksAgentId = msg.agentId as string | undefined;
      const allHooks = await getHooks();
      return { hooks: hooksAgentId ? allHooks.filter((h) => h.agentId === hooksAgentId) : allHooks };
    }

    case 'deleteArtifact': {
      const { deleteArtifact } = await import('./storage/shared.js');
      await deleteArtifact(msg.artifactPath as string);
      return { deleted: true };
    }

    case 'updateArtifactMeta': {
      const { updateArtifactMeta } = await import('./storage/shared.js');
      await updateArtifactMeta(
        msg.artifactPath as string,
        msg.updates as Partial<Pick<import('./storage/types.js').ArtifactMeta, 'pinned' | 'title' | 'tags' | 'type'>>,
      );
      return { updated: true };
    }

    case 'deleteTask': {
      const { deleteTask } = await import('./storage/shared.js');
      await deleteTask(msg.taskId as string);
      return { deleted: true };
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

    case 'listSkills': {
      const skills = await listSkills(msg.agentId as string);
      return { skills };
    }

    case 'installSkill': {
      const { meta: fmMeta } = parseFrontmatter(msg.content as string);
      const files = new Map<string, string>();
      files.set('SKILL.md', msg.content as string);
      if (msg.referenceFiles) {
        for (const [path, content] of Object.entries(msg.referenceFiles as Record<string, string>)) {
          files.set(path, content);
        }
      }
      const skillId = await installSkill(
        msg.agentId as string,
        {
          name: fmMeta.name || (msg.name as string),
          description: fmMeta.description || (msg.description as string),
          author: fmMeta.author,
          version: fmMeta.version,
          source: msg.source as string | undefined,
        },
        files,
      );
      return { skillId };
    }

    case 'removeSkill': {
      await removeSkill(msg.agentId as string, msg.skillId as string);
      return { removed: true };
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
      const { agent: schedAgent } = await createExtensionAgent(task.agentId, {
        task: task.prompt,
        source: 'task',
      });
      const schedResult = await schedAgent.run(task.prompt);
      await updateScheduledTaskRun(task.alarmId, schedResult || '(no output)');
      return { ran: true, result: (schedResult || '').slice(0, 200) };
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

        const settings = await getSettings();
        const keys = await getApiKeys();
        const provider = settings.activeProvider as keyof typeof keys;
        const apiKey = keys[provider];
        if (!apiKey) return { error: `No API key configured for ${settings.activeProvider}. Add one in Global Settings.` };

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

        // Record usage
        try {
          const settings2 = await getSettings();
          await recordUsage({
            agentId: 'system',
            agentName: 'Prompt Refinement',
            provider: settings2.activeProvider as any,
            model: settings2.model || 'unknown',
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            source: 'refine',
          });
        } catch { /* usage tracking is best-effort */ }

        return { refined: result.text };
      } catch (err) {
        console.error('refinePrompt failed:', err);
        return { error: `Refinement failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'getUsageSummary': {
      const since = msg.since as string | undefined;
      const summary = await getUsageSummary(since);
      return { summary };
    }

    case 'getUsageRecords': {
      const records = await getUsage({
        agentId: msg.agentId as string | undefined,
        provider: msg.provider as string | undefined,
        since: msg.since as string | undefined,
        limit: (msg.limit as number) || 50,
      });
      return { records };
    }

    case 'clearUsage': {
      await clearUsage();
      return { ok: true };
    }

    case 'getAgentSpendingLimit': {
      const id = msg.agentId as string;
      const result = await chrome.storage.local.get(`chaos:spending-limit:${id}`);
      return { limit: result[`chaos:spending-limit:${id}`] ?? null };
    }

    case 'setAgentSpendingLimit': {
      const id = msg.agentId as string;
      const limit = msg.limit as number | null;
      if (limit === null) {
        await chrome.storage.local.remove(`chaos:spending-limit:${id}`);
      } else {
        await chrome.storage.local.set({ [`chaos:spending-limit:${id}`]: limit });
      }
      return { ok: true };
    }

    case 'startChannelPolling': {
      const interval = (msg.intervalMinutes as number) || 1;
      startChannelPolling(interval);
      startWebSocket();
      return { ok: true };
    }

    case 'stopChannelPolling': {
      stopChannelPolling();
      stopWebSocket();
      return { ok: true };
    }

    case 'listArchivedAgents': {
      const archived = await listArchivedAgents();
      return { agents: archived };
    }

    case 'archiveAgent': {
      await archiveAgent(msg.agentId as string);
      return { archived: true };
    }

    case 'restoreAgent': {
      const restored = await restoreAgent(msg.agentId as string);
      if (restored) {
        return { restored: true, agent: restored };
      }
      return { error: 'Agent not found in archive' };
    }

    case 'deleteArchivedAgent': {
      // Permanently delete an archived agent's OPFS data
      try {
        await opfs.delete(`agents/${msg.agentId as string}`);
        return { deleted: true };
      } catch {
        return { error: 'Failed to delete archived agent data' };
      }
    }

    case 'fetchSkillPreviewOneShot': {
      try {
        const fetched = await fetchSkillFromUrl(msg.url as string);
        const skillContent = fetched.files.get('SKILL.md') || '';
        const preview = skillContent.length > 2000 ? skillContent.slice(0, 2000) + '\n...' : skillContent;
        return {
          meta: fetched.meta,
          preview,
          fileCount: fetched.files.size,
          files: Array.from(fetched.files.keys()),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'importSkillFromUrlOneShot': {
      try {
        const fetched = await fetchSkillFromUrl(msg.url as string);
        const skillId = await installSkill(
          msg.agentId as string,
          {
            name: fetched.meta.name,
            description: fetched.meta.description,
            author: fetched.meta.author,
            version: fetched.meta.version,
            source: msg.url as string,
          },
          fetched.files,
        );
        return { skillId, meta: fetched.meta, fileCount: fetched.files.size };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'gatherBrowsingContext': {
      const permissions: string[] = [];
      const historyUrls: Array<{ url: string; title: string; visitTime: number }> = [];
      const bookmarks: Array<{ url: string; title: string; dateAdded: number }> = [];
      const openTabs: Array<{ url: string; title: string }> = [];
      const readingList: Array<{ url: string; title: string }> = [];

      // Check which permissions are granted
      const permChecks = ['history', 'bookmarks', 'tabs'] as const;
      for (const perm of permChecks) {
        try {
          const granted = await chrome.permissions.contains({ permissions: [perm] });
          if (granted) permissions.push(perm);
        } catch { /* not available */ }
      }
      // readingList permission check
      try {
        const granted = await chrome.permissions.contains({ permissions: ['readingList' as string] as chrome.permissions.Permissions['permissions'] });
        if (granted) permissions.push('readingList');
      } catch { /* not available */ }

      // Gather history
      if (permissions.includes('history')) {
        try {
          const items = await chrome.history.search({
            text: '',
            startTime: Date.now() - 48 * 60 * 60 * 1000,
            maxResults: 200,
          });
          for (const item of items) {
            if (item.url && item.title) {
              historyUrls.push({
                url: item.url,
                title: item.title,
                visitTime: item.lastVisitTime || Date.now(),
              });
            }
          }
        } catch (err) {
          console.warn('[smart-start] Failed to gather history:', err);
        }
      }

      // Gather bookmarks
      if (permissions.includes('bookmarks')) {
        try {
          const items = await chrome.bookmarks.getRecent(20);
          for (const item of items) {
            if (item.url && item.title) {
              bookmarks.push({
                url: item.url,
                title: item.title,
                dateAdded: item.dateAdded || Date.now(),
              });
            }
          }
        } catch (err) {
          console.warn('[smart-start] Failed to gather bookmarks:', err);
        }
      }

      // Gather open tabs
      if (permissions.includes('tabs')) {
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.url && tab.title) {
              openTabs.push({ url: tab.url, title: tab.title });
            }
          }
        } catch (err) {
          console.warn('[smart-start] Failed to gather tabs:', err);
        }
      }

      // Try reading list (may not exist in all browsers)
      if (permissions.includes('readingList')) {
        try {
          const items = await (chrome as any).readingList.query({});
          for (const item of items) {
            if (item.url && item.title) {
              readingList.push({ url: item.url, title: item.title });
            }
          }
        } catch (err) {
          console.warn('[smart-start] readingList not available:', err);
        }
      }

      console.log(`[smart-start] Gathered ${historyUrls.length} history items, ${bookmarks.length} bookmarks, ${openTabs.length} tabs`);

      return {
        historyUrls,
        bookmarks,
        openTabs,
        readingList,
        permissions,
      };
    }

    case 'analyzeForSmartStart': {
      const fallbackSuggestions = {
        summary: 'Welcome! I can help you navigate the web more efficiently. Here are some things to try.',
        actions: [
          { title: 'Summarize this page', description: 'Read and summarize the content of your current tab', prompt: 'Summarize the current page I\'m viewing. Give me the key points and takeaways.' },
          { title: 'Organize my tabs', description: 'Group your open tabs into logical categories', prompt: 'Look at all my open tabs and suggest how to organize them into groups. Then help me group them.' },
          { title: 'What\'s interesting?', description: 'Find interesting patterns in your open tabs', prompt: 'Look at my open tabs and tell me what\'s interesting. What themes do you see? What should I pay attention to?' },
        ],
        hookSuggestions: [
          { description: 'Auto-summarize bookmarked pages', trigger: { type: 'bookmark-created' as const }, prompt: 'A new bookmark was just created. Read the bookmarked page and write a brief summary of its content. Save it to memories so I can find it later.', reason: 'Get automatic summaries of pages you bookmark.' },
          { description: 'Daily review', trigger: { type: 'browser-startup' as const }, prompt: 'Good morning! Do a quick review: check my recent history, any pending tasks, and suggest 3 things I could work on today.', reason: 'Start each day with a quick briefing.' },
        ],
      };

      try {
        const context = msg.context as {
          historyUrls: Array<{ url: string; title: string; visitTime: number }>;
          bookmarks: Array<{ url: string; title: string; dateAdded: number }>;
          openTabs: Array<{ url: string; title: string }>;
          readingList: Array<{ url: string; title: string }>;
          permissions: string[];
        };

        // If no meaningful context, return fallback
        if (!context || (context.historyUrls.length === 0 && context.bookmarks.length === 0 && context.openTabs.length === 0)) {
          console.log('[smart-start] No browsing context available, returning fallback suggestions');
          return fallbackSuggestions;
        }

        const settings = await getSettings();
        const keys = await getApiKeys();
        const provider = settings.activeProvider as keyof typeof keys;
        const apiKey = keys[provider];
        if (!apiKey) {
          console.warn('[smart-start] No API key configured, returning fallback');
          return fallbackSuggestions;
        }

        const model = createLanguageModel(settings.activeProvider, apiKey, settings.model);

        // Build context description
        let contextDesc = '';
        if (context.historyUrls.length > 0) {
          contextDesc += 'Recent browsing history (last 48h):\n';
          for (const item of context.historyUrls.slice(0, 50)) {
            contextDesc += `- ${item.title} (${item.url})\n`;
          }
          contextDesc += '\n';
        }
        if (context.openTabs.length > 0) {
          contextDesc += 'Currently open tabs:\n';
          for (const item of context.openTabs) {
            contextDesc += `- ${item.title} (${item.url})\n`;
          }
          contextDesc += '\n';
        }
        if (context.bookmarks.length > 0) {
          contextDesc += 'Recent bookmarks:\n';
          for (const item of context.bookmarks) {
            contextDesc += `- ${item.title} (${item.url})\n`;
          }
          contextDesc += '\n';
        }
        if (context.readingList.length > 0) {
          contextDesc += 'Reading list:\n';
          for (const item of context.readingList) {
            contextDesc += `- ${item.title} (${item.url})\n`;
          }
          contextDesc += '\n';
        }

        const result = await generateText({
          model,
          system: `You are helping a new user get started with an AI browser assistant called CHAOS.
Based on their recent browsing activity, suggest specific things the assistant could help with RIGHT NOW.

You MUST respond with valid JSON matching this exact schema (no markdown, no code fences, just raw JSON):
{
  "summary": "A brief friendly summary of what you notice about their browsing (2-3 sentences)",
  "actions": [
    {
      "title": "Short action title (max 6 words)",
      "description": "What the assistant will do (1 sentence)",
      "prompt": "The exact prompt to send to the assistant"
    }
  ],
  "hookSuggestions": [
    {
      "description": "What the hook does",
      "trigger": { "type": "trigger-type" },
      "prompt": "The hook prompt",
      "reason": "Why this hook would be useful for this user"
    }
  ]
}

For trigger types, use one of: bookmark-created, tab-navigated, tab-created, browser-startup, download-completed, history-visited, idle-changed.
For tab-navigated and history-visited triggers, include a "urlPattern" field in the trigger object.

Generate 3-5 actions and 2-3 hook suggestions. Make them specific to what the user has actually been browsing.`,
          prompt: contextDesc,
        });

        // Parse the response
        const text = result.text.trim();
        // Try to extract JSON from the response (handle potential markdown wrapping)
        let jsonStr = text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        const parsed = JSON.parse(jsonStr);
        console.log('[smart-start] LLM analysis complete:', parsed.actions?.length, 'actions,', parsed.hookSuggestions?.length, 'hooks');
        return {
          summary: parsed.summary || fallbackSuggestions.summary,
          actions: Array.isArray(parsed.actions) ? parsed.actions : fallbackSuggestions.actions,
          hookSuggestions: Array.isArray(parsed.hookSuggestions) ? parsed.hookSuggestions : fallbackSuggestions.hookSuggestions,
        };
      } catch (err) {
        console.error('[smart-start] Analysis failed, returning fallback:', err);
        return fallbackSuggestions;
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

  // Channel polling alarm
  if (isChannelPollAlarm(alarm.name)) {
    await handlePollAlarm();
    return;
  }

  console.log(`Alarm fired: ${alarm.name}`);

  try {
    // Look up a scheduled task for this alarm
    const tasks = await getScheduledTasks();
    const task = tasks.find((t) => t.alarmId === alarm.name);

    if (alarm.name.startsWith('agentic:')) {
      // Legacy alarm-based task trigger (kept for backwards compat)
      const parts = alarm.name.split(':');
      const agentId = parts[1];
      const taskId = parts.slice(2).join(':');
      await executeAssignedTask(agentId, taskId);
    } else if (task) {
      // Run a full agentic loop with the stored prompt (multi-step autonomous)
      const { agent: alarmAgent } = await createExtensionAgent(task.agentId, {
        task: task.prompt,
        source: 'task',
      });
      const result = await alarmAgent.run(task.prompt);

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
        const legacyTask = 'You were woken up by a scheduled alarm. Check your TODO list and pending messages, then do any work that needs doing.';
        const { agent: legacyAgent } = await createExtensionAgent(agentId, {
          task: legacyTask,
          source: 'task',
        });
        await legacyAgent.run(legacyTask);
      } else {
        console.warn(`Unknown alarm with no scheduled task: ${alarm.name}`);
      }
    }
  } catch (err) {
    console.error(`Alarm handler failed for ${alarm.name}:`, err);
  }
});

// ── Channel polling setup ──
// Register the message handler and start polling if configured

setMessageHandler(async (message) => {
  // Find an agent to handle this channel message
  const agents = await listAgents();
  if (agents.length === 0) return null;

  // Route to the agent specified on the channel, or fall back to master agent
  const channelAgentId = message.metadata?.['channelAgentId'] as string | undefined;
  const targetAgent = (channelAgentId && agents.find((a) => a.id === channelAgentId)) ||
    agents.find((a) => a.master) || agents[0];
  const master = targetAgent;
  const channelName = message.metadata?.['channelName'] as string || message.channelType;
  const channelPrompt = message.metadata?.['channelPrompt'] as string || '';
  const direction = message.metadata?.['channelDirection'] as string || 'bidirectional';
  const defaultInstruction = direction === 'inbound'
    ? 'Process this message according to the instructions below.'
    : `Your final response will be sent back to ${message.from} via ${channelName} as a direct reply. Include the full answer in your response — do not just describe what you did, provide the actual content they asked for. For example, if they ask you to summarise a page, your response should BE the summary, not "I summarised the page."`;
  const task = `You received a message from an external channel.\n\nChannel: ${channelName} (${message.channelType})\nFrom: ${message.from}\nMessage:\n${message.content}\n\n${channelPrompt || defaultInstruction}`;

  // Generate a unique column ID for this channel conversation
  const channelColumnId = `channel-${message.channelId}-${Date.now()}`;

  // Notify UI to open a channel column — use activeUiPort directly (not captured)
  const channelLabel = message.channelType === 'telegram'
    ? `Telegram`
    : message.channelType.charAt(0).toUpperCase() + message.channelType.slice(1);

  if (activeUiPort) {
    try {
      activeUiPort.postMessage({
        type: 'channelMessageReceived',
        agentId: master.id,
        columnId: channelColumnId,
        channelLabel,
        from: message.from,
        content: message.content,
        channelType: message.channelType,
        channelId: message.channelId,
      });
    } catch { /* port disconnected */ }
  }

  // Signal UI that agentic loop is starting
  if (activeUiPort) {
    try { activeUiPort.postMessage({ type: 'agenticStart', agentId: master.id, columnId: channelColumnId }); } catch { /* */ }
  }

  console.log(`[channel] Starting agent loop for ${master.name} (${master.id}), channel: ${channelName}, columnId: ${channelColumnId}`);

  // Run the agentic loop — stream progress to UI if available
  const { agent: channelAgent } = await createExtensionAgent(master.id, {
    task,
    source: 'channel',
  });

  let result = '';
  for await (const event of channelAgent.stream(task)) {
    const update = mapProgressEvent(event, DEFAULT_MAX_ITERATIONS_BG);
    if (event.type === 'done' || event.type === 'text') {
      result = event.content;
    }
    // Use activeUiPort directly — survives reconnects
    if (!activeUiPort) continue;
    try {
      activeUiPort.postMessage({
        type: 'agenticProgress',
        agentId: master.id,
        columnId: channelColumnId,
        progressType: update.type,
        content: update.content,
        toolName: update.toolName,
        toolArgs: update.toolArgs,
        toolResult: update.toolResult,
        iteration: update.iteration,
        totalIterations: update.totalIterations,
      });
    } catch {
      // Port disconnected — don't abort, agent keeps working
    }
  }

  console.log(`[channel] Agent loop completed for channel ${channelName}, result length: ${result.length}`);

  if (activeUiPort) {
    try {
      activeUiPort.postMessage({ type: 'agenticDone', result, agentId: master.id, columnId: channelColumnId });
    } catch { /* */ }
  }

  return result || null;
});

// Start polling and WebSocket if relay is configured
getRelaySettings().then((settings) => {
  if (settings) {
    startChannelPolling(settings.pollIntervalMinutes);
    startWebSocket();
  }
}).catch((err) => {
  console.error('Failed to initialize channel polling:', err);
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
