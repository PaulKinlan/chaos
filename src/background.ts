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
import { getApiKeys, setApiKeys } from './storage/chrome-storage.js';
import { getMessages } from './storage/shared.js';
import { getTaskState } from './storage/shared.js';
import { listArtifacts } from './storage/shared.js';
import { opfs } from './storage/opfs.js';

// ── Side panel behavior ──

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── Installation ──

chrome.runtime.onInstalled.addListener(() => {
  console.log('CHAOS extension installed');
  setupContextMenus();
});

// ── Context menus ──

async function setupContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();

  // Parent menu
  chrome.contextMenus.create({
    id: 'chaos-parent',
    title: 'Send to CHAOS agent',
    contexts: ['selection', 'page'],
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
}

/** Refresh context menu items when agents change. */
async function refreshContextMenus(): Promise<void> {
  await setupContextMenus();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith('chaos-agent-')) return;

  const agentId = menuId.replace('chaos-agent-', '');
  let content = '';

  if (info.selectionText) {
    content = info.selectionText;
  } else if (tab?.id) {
    // Extract full page content
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'extractContent',
      });
      content = response?.content || '';
    } catch {
      content = `(Could not extract content from: ${tab.url || 'this page'})`;
    }
  }

  if (!content) return;

  // Run agent loop with the content
  try {
    await runAgentLoop({
      agentId,
      userMessage: `The user sent you this content via context menu:\n\n${content}`,
    });
  } catch (err) {
    console.error('Context menu agent loop failed:', err);
  }
});

// ── Port-based streaming communication ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chaos-sidepanel') return;

  port.onMessage.addListener(async (msg) => {
    try {
      switch (msg.type) {
        case 'chat':
          await handleChat(port, msg);
          break;

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

// ── Message handlers ──

async function handleChat(
  port: chrome.runtime.Port,
  msg: {
    agentId: string;
    message: string;
    pageContext?: { title: string; url: string; content: string };
  },
): Promise<void> {
  port.postMessage({ type: 'chatStart' });

  try {
    const fullResponse = await runAgentLoop({
      agentId: msg.agentId,
      userMessage: msg.message,
      pageContext: msg.pageContext,
      onChunk: (chunk: string) => {
        try {
          port.postMessage({ type: 'chatChunk', chunk });
        } catch {
          // Port may have disconnected
        }
      },
    });

    port.postMessage({ type: 'chatEnd', fullResponse });
  } catch (err) {
    port.postMessage({
      type: 'chatError',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleExtractContent(port: chrome.runtime.Port): Promise<void> {
  try {
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

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'extractContent',
    });

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
  msg: { name: string; role: string },
): Promise<void> {
  const agent = await createAgent(msg.name, msg.role);
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

    case 'openDashboard': {
      const url = chrome.runtime.getURL('app.html');
      await chrome.tabs.create({ url });
      return { opened: true };
    }

    default:
      throw new Error(`Unknown one-shot message type: ${msg.type}`);
  }
}

// ── Alarm handling for scheduled agent wake-ups ──

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Alarm names follow the pattern: chaos-agent-{agentId}
  if (!alarm.name.startsWith('chaos-agent-')) return;

  const agentId = alarm.name.replace('chaos-agent-', '');
  console.log(`Alarm fired for agent: ${agentId}`);

  try {
    await runAgentLoop({
      agentId,
      userMessage:
        'You were woken up by a scheduled alarm. Check your TODO list and pending messages, then do any work that needs doing.',
    });
  } catch (err) {
    console.error(`Alarm handler failed for agent ${agentId}:`, err);
  }
});
