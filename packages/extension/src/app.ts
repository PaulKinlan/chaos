/**
 * Dashboard UI (app.html)
 *
 * New layout model:
 * - Top bar: Agent tabs (like browser tabs) with [+] to create
 * - Left sidebar: View navigation (Chat, Tasks, Messages, Artifacts, Files, Agent Settings)
 * - Main area: The selected view, filtered to the active agent
 * - Global settings accessible via gear icon in top bar
 *
 * Chat uses a long-lived port (like sidepanel.ts) for streaming.
 * Dashboard views use chrome.runtime.sendMessage (one-shot request/response).
 */

// ── Single-instance guard ──
// Only one CHAOS dashboard tab should be active at a time to prevent
// duplicate WebSocket connections, poll handlers, and agentic loop races.
const singleInstanceChannel = new BroadcastChannel('chaos-single-instance');
let isBlocked = false;

// Ask if anyone else is running
singleInstanceChannel.postMessage({ type: 'ping' });

singleInstanceChannel.onmessage = (event) => {
  if (event.data.type === 'ping' && !isBlocked) {
    // Another tab is checking — tell it we're here
    singleInstanceChannel.postMessage({ type: 'pong' });
  } else if (event.data.type === 'pong' && !isBlocked) {
    // Another tab is already running — block this one
    isBlocked = true;
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;background:var(--bg-base, #0f1117);color:var(--text-primary, #e1e4e8);">
        <div style="text-align:center;max-width:400px;padding:32px;">
          <h2 style="margin-bottom:12px;">CHAOS is already open</h2>
          <p style="color:var(--text-secondary, #8b949e);margin-bottom:16px;">Another tab is already running the CHAOS dashboard. Only one instance can be active at a time to prevent conflicts.</p>
          <button onclick="location.reload()" style="padding:8px 16px;background:var(--bg-raised, #161b22);border:1px solid var(--border-default, #30363d);border-radius:6px;color:var(--text-primary, #e1e4e8);cursor:pointer;">Retry</button>
        </div>
      </div>`;
  }
};

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentMeta, AgentMessage, Task, ArtifactMeta, ApiKeys, ScheduledTask, Hook, HookTrigger, AgenticProgressEntry } from './storage/types.js';
import { getAllPermissions, setPermission, DEFAULT_PERMISSIONS, type PermissionLevel } from './tools/permissions.js';
import { needsSandbox, renderInSandbox } from './ui/sandbox-renderer.js';
import { hasPermission, hasHostPermissions } from './permissions.js';
import { toolRegistry } from './tools/lookup/registry.js';
import { getFallbackModels, type ModelOption } from './agents/provider-registry.js';
import type { ToolMeta } from './tools/lookup/types.js';

// ── Configure marked ──

marked.setOptions({
  gfm: true,
  breaks: true,
});

// ── State ──

let agents: AgentMeta[] = [];
let tasks: Task[] = [];
let scheduledTasks: ScheduledTask[] = [];
let messages: AgentMessage[] = [];
let artifacts: ArtifactMeta[] = [];

// Active agent & view
let activeAgentId: string | null = null;
let activeView: string = 'chat';

// ── Hash-based routing ──
// Format: #agent={id}&view={name} or #settings

function updateHash(): void {
  if (activeView === 'global-settings') {
    history.replaceState(null, '', '#settings');
  } else if (activeAgentId) {
    history.replaceState(null, '', `#agent=${activeAgentId}&view=${activeView}`);
  } else {
    history.replaceState(null, '', '#');
  }
}

function parseHash(): { agentId: string | null; view: string } {
  const hash = location.hash.slice(1);
  if (hash === 'settings') {
    return { agentId: null, view: 'global-settings' };
  }
  const params = new URLSearchParams(hash);
  return {
    agentId: params.get('agent'),
    view: params.get('view') || 'chat',
  };
}

// Tracks a "Run Now" scheduled task so agenticDone can update its record
let pendingRunNowAlarmId: string | null = null;

// Chat state
let port: chrome.runtime.Port | null = null;
// Chat streaming state is now per-column (see ChatColumn interface)
let reconnectAttempts = 0;
const MAX_RECONNECT_RETRIES = 3;

interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  pageContext?: { title: string; url: string };
  progress?: AgenticProgressEntry[];
}

// Conversation history is now per-column (see ChatColumn interface)

// Context menu state
let contextMenuAgentId: string | null = null;

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return 'minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'day';
  if (days === 7) return 'week';
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'week';
  if (days === 14) return '2 weeks';
  if (days === 30 || days === 31) return 'month';
  return `${days} days`;
}

function formatTimeFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function agentName(agentId: string): string {
  const agent = agents.find((a) => a.id === agentId);
  return agent ? agent.name : agentId;
}

function agentRole(agentId: string): string {
  const agent = agents.find((a) => a.id === agentId);
  return agent ? agent.role : 'unknown';
}

function roleBadgeClass(role: string): string {
  return `role-${role}`;
}

function visBadgeClass(vis: string): string {
  return `vis-${vis}`;
}

function statusBadgeClass(status: string): string {
  return `status-${status}`;
}

// ── Theme ──

function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Load and apply theme on startup
chrome.storage.sync.get('chaos:settings').then((result) => {
  const settings = result['chaos:settings'] as { theme?: string } | undefined;
  const theme = (settings?.theme ?? 'system') as 'system' | 'light' | 'dark';
  applyTheme(theme);
});

// ── One-shot messaging (for dashboard views) ──

async function sendMsg<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  const result = await (chrome.runtime.sendMessage(msg) as Promise<T & { error?: string }>);
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw new Error(result.error);
  }
  return result;
}

function showPanelLoading(panelId: string): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  let spinner = panel.querySelector('.panel-spinner') as HTMLDivElement | null;
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.className = 'panel-spinner';
    spinner.innerHTML = '<div class="spinner"></div><span>Loading...</span>';
    panel.prepend(spinner);
  }
  spinner.style.display = '';
}

function hidePanelLoading(panelId: string): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const spinner = panel.querySelector('.panel-spinner') as HTMLDivElement | null;
  if (spinner) spinner.style.display = 'none';
}

function showPanelError(panelId: string, message: string): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  let errorEl = panel.querySelector('.panel-error') as HTMLDivElement | null;
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'panel-error';
    panel.prepend(errorEl);
  }
  errorEl.textContent = message;
  errorEl.style.display = '';
  setTimeout(() => {
    if (errorEl) errorEl.style.display = 'none';
  }, 5000);
}

// ══════════════════════════════════════════
// ── Agent Tabs
// ══════════════════════════════════════════

const agentTabsScroll = document.getElementById('agent-tabs-scroll')!;

function renderAgentTabs(): void {
  // Render agents in sidebar instead of top tab bar
  const sidebarAgentList = document.getElementById('sidebar-agent-list');
  if (!sidebarAgentList) return;
  sidebarAgentList.innerHTML = '';

  for (const agent of agents) {
    // Agent item (clickable to select)
    const agentItem = document.createElement('div');

    const btn = document.createElement('button');
    btn.className = 'sidebar-agent-item' + (agent.id === activeAgentId ? ' active' : '');
    btn.dataset.agentId = agent.id;

    // Icon: star for master, user for others
    if (agent.master) {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    } else {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'agent-name';
    nameEl.textContent = agent.name;
    btn.appendChild(nameEl);

    btn.addEventListener('click', () => {
      switchToAgent(agent.id);
      // Default to chat when clicking agent name
      if (activeView === 'files' || activeView === 'agent-settings') {
        // Stay on current view
      } else {
        activeView = 'chat';
        updateViewVisibility();
      }
    });

    agentItem.appendChild(btn);

    // Sub-items always visible for all agents
    const isActive = agent.id === activeAgentId;
    const sub = document.createElement('div');
    sub.className = 'sidebar-agent-sub';

    const memBtn = document.createElement('button');
    memBtn.className = 'sidebar-item' + (isActive && activeView === 'files' ? ' active' : '');
    memBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="label">Memory</span>';
    memBtn.addEventListener('click', () => {
      if (activeAgentId !== agent.id) switchToAgent(agent.id);
      activeView = 'files';
      updateHash();
      updateViewVisibility();
      loadCurrentViewData();
      renderAgentTabs(); // refresh active states
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'sidebar-item' + (isActive && activeView === 'agent-settings' ? ' active' : '');
    settingsBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span class="label">Settings</span>';
    settingsBtn.addEventListener('click', () => {
      if (activeAgentId !== agent.id) switchToAgent(agent.id);
      activeView = 'agent-settings';
      updateHash();
      updateViewVisibility();
      loadCurrentViewData();
      renderAgentTabs(); // refresh active states
    });

    sub.appendChild(memBtn);
    sub.appendChild(settingsBtn);
    agentItem.appendChild(sub);

    sidebarAgentList.appendChild(agentItem);
  }

  // Also update the old tab bar for any code that still references it
  agentTabsScroll.innerHTML = '';
}

function switchToAgent(agentId: string): void {
  if (activeAgentId === agentId) return;

  activeAgentId = agentId;
  if (activeView === 'global-settings') activeView = 'chat'; // switch away from settings
  updateHash();

  // Re-render sidebar agent list to show sub-items for active agent
  renderAgentTabs();

  // Show sidebar (in case we were on no-agent state)
  updateViewVisibility();

  // Ensure there's a column for this agent
  if (!getColumnForAgent(agentId)) {
    addColumn(agentId);
  }

  // Focus the column for this agent
  const col = getColumnForAgent(agentId);
  if (col) {
    focusedColumnId = col.id;
    col.columnEl.scrollIntoView({ behavior: 'smooth', inline: 'start' });
  }

  // Refresh current view data
  loadCurrentViewData();
}

function updateViewVisibility(): void {
  const noAgentPanel = document.getElementById('view-no-agent')!;
  const viewPanels = document.querySelectorAll<HTMLDivElement>('.view-panel:not(#view-no-agent):not(#view-global-settings)');

  if (!activeAgentId) {
    // Show no-agent state, hide everything else
    noAgentPanel.classList.add('active');
    viewPanels.forEach((p) => p.classList.remove('active'));
    document.getElementById('view-global-settings')!.classList.remove('active');
    return;
  }

  noAgentPanel.classList.remove('active');
  document.getElementById('view-global-settings')!.classList.remove('active');

  // Show the active view
  viewPanels.forEach((p) => {
    const viewId = p.id.replace('view-', '');
    p.classList.toggle('active', viewId === activeView);
  });
}

// ══════════════════════════════════════════
// ── Sidebar Navigation
// ══════════════════════════════════════════

const sidebarItems = document.querySelectorAll<HTMLButtonElement>('.sidebar-item');
const sidebarEl = document.getElementById('sidebar')!;
const sidebarToggle = document.getElementById('sidebar-toggle');

// Sidebar collapse/expand toggle
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    sidebarEl.classList.toggle('collapsed');
    // Persist preference
    chrome.storage.local.set({ 'chaos:sidebarCollapsed': sidebarEl.classList.contains('collapsed') });
  });

  // Restore persisted state
  chrome.storage.local.get('chaos:sidebarCollapsed').then((result) => {
    if (result['chaos:sidebarCollapsed']) {
      sidebarEl.classList.add('collapsed');
    }
  });
}

sidebarItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view!;

    if (!activeAgentId && view !== 'global-settings') {
      return; // Don't switch views if no agent selected
    }

    activeView = view;
    updateHash();

    // Update sidebar highlights
    sidebarItems.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Show the correct panel
    updateViewVisibility();

    // Load data for the view
    loadCurrentViewData();
  });
});

// Global settings — shared logic used by button click and hash navigation
function showGlobalSettings(updateURL = true): void {
  if (activeView === 'global-settings') return; // already showing
  activeView = 'global-settings';
  if (updateURL) updateHash();

  // Deselect sidebar items
  sidebarItems.forEach((b) => b.classList.remove('active'));

  // Hide all views, show global settings
  document.querySelectorAll<HTMLDivElement>('.view-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('view-global-settings')!.classList.add('active');

  loadSettings();
  loadPermissions();
  loadBrowserPermissions();
}

// Global settings buttons (old top-bar one kept for compatibility, plus new sidebar one)
document.getElementById('btn-global-settings')!.addEventListener('click', () => {
  showGlobalSettings();
});
document.getElementById('btn-global-settings-sidebar')?.addEventListener('click', () => {
  showGlobalSettings();
});

// Sidebar add-agent button
document.getElementById('btn-add-agent-sidebar')?.addEventListener('click', () => {
  // Trigger the same create agent modal as the top bar + button
  document.getElementById('btn-add-agent')?.click();
});

function loadCurrentViewData(): void {
  switch (activeView) {
    case 'chat':
      // Chat is always connected via port
      break;
    case 'tasks':
      loadTasks();
      break;
    case 'messages':
      loadMessages();
      break;
    case 'artifacts':
      loadArtifacts();
      break;
    case 'channels':
      renderChannelsUI();
      break;
    case 'files':
      loadFilesView();
      break;
    case 'hooks':
      loadHooksView();
      break;
    case 'agent-settings':
      loadAgentSettings();
      break;
    case 'global-settings':
      loadSettings();
      loadPermissions();
      loadBrowserPermissions();
      break;
  }
}

// ══════════════════════════════════════════
// ── Agent Tab Context Menu
// ══════════════════════════════════════════

const contextMenu = document.getElementById('agent-tab-context-menu')!;

function showAgentContextMenu(e: MouseEvent, agentId: string): void {
  contextMenuAgentId = agentId;
  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.classList.add('visible');
}

function hideContextMenu(): void {
  contextMenu.classList.remove('visible');
  contextMenuAgentId = null;
}

document.addEventListener('click', () => hideContextMenu());
document.addEventListener('contextmenu', (e) => {
  if (!contextMenu.contains(e.target as Node)) {
    hideContextMenu();
  }
});

document.getElementById('ctx-rename-agent')!.addEventListener('click', () => {
  if (!contextMenuAgentId) return;
  const agent = agents.find((a) => a.id === contextMenuAgentId);
  if (!agent) return;

  const newName = prompt('Rename agent:', agent.name);
  if (newName && newName.trim() && newName.trim() !== agent.name) {
    sendMsg({ type: 'renameAgent', agentId: contextMenuAgentId, name: newName.trim() }).then(() => {
      // Refresh agent list
      sendPortMessage({ type: 'listAgents' });
    }).catch(() => {
      // Fallback: just refresh
      sendPortMessage({ type: 'listAgents' });
    });
  }
  hideContextMenu();
});

document.getElementById('ctx-visibility-agent')!.addEventListener('click', () => {
  if (!contextMenuAgentId) return;
  const agent = agents.find((a) => a.id === contextMenuAgentId);
  if (!agent) return;

  const options = ['private', 'visible', 'open'];
  const currentIdx = options.indexOf(agent.visibility);
  const nextVis = options[(currentIdx + 1) % options.length];

  sendMsg({ type: 'updateAgentVisibility', agentId: contextMenuAgentId, visibility: nextVis }).then(() => {
    sendPortMessage({ type: 'listAgents' });
  }).catch(() => {
    sendPortMessage({ type: 'listAgents' });
  });
  hideContextMenu();
});

document.getElementById('ctx-delete-agent')!.addEventListener('click', () => {
  if (!contextMenuAgentId) return;
  const agent = agents.find((a) => a.id === contextMenuAgentId);
  if (!agent) return;

  const deleteId = contextMenuAgentId;
  hideContextMenu();

  showConfirm(
    'Delete Agent',
    `Are you sure you want to delete "${agent.name}"? This cannot be undone.`,
    async () => {
      await sendMsg({ type: 'deleteAgent', agentId: deleteId });
      if (activeAgentId === deleteId) {
        activeAgentId = null;
        activeView = 'chat';
        sidebarItems.forEach((b) => {
          b.classList.toggle('active', b.dataset.view === 'chat');
        });
      }
      sendPortMessage({ type: 'listAgents' });
    },
  );
});

// ══════════════════════════════════════════
// ── Multi-column Chat (port-based streaming)
// ══════════════════════════════════════════

interface ChatColumn {
  id: string;
  agentId: string;
  messagesEl: HTMLDivElement;
  inputEl: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  micBtn: HTMLButtonElement;
  typingEl: HTMLDivElement;
  columnEl: HTMLDivElement;
  mentionDropdown: HTMLDivElement;
  mentionDropdownHeader: HTMLDivElement;
  mentionDropdownList: HTMLUListElement;
  conversationHistory: ConversationEntry[];
  isStreaming: boolean;
  currentStreamEl: HTMLDivElement | null;
  currentStreamContent: string;
  lastAgenticText: string;
  pageContext: { title: string; url: string; content: string } | null;
  currentStepDetails: HTMLDetailsElement | null;
  currentStepContent: HTMLDivElement | null;
  currentStepSummary: HTMLElement | null;
  currentStepToolNames: string[];
  currentStepStartTime: number | null;
  currentStepNumber: number;
  currentProgressEntries: AgenticProgressEntry[];
}

let columns: ChatColumn[] = [];
const columnsContainer = document.getElementById('columns-container') as HTMLDivElement;
const columnAddPicker = document.getElementById('column-add-picker') as HTMLDivElement;

// Track which column is focused (for mention system, voice input, etc.)
let focusedColumnId: string | null = null;

function getColumnForAgent(agentId: string): ChatColumn | undefined {
  // Prefer the focused column if it matches the agent
  if (focusedColumnId) {
    const focused = columns.find((c) => c.id === focusedColumnId && c.agentId === agentId);
    if (focused) return focused;
  }
  // Prefer a column that's currently streaming (active task)
  const streaming = columns.find((c) => c.agentId === agentId && c.isStreaming);
  if (streaming) return streaming;
  // Fall back to first match
  return columns.find((c) => c.agentId === agentId);
}

function getFocusedColumn(): ChatColumn | undefined {
  if (focusedColumnId) {
    const col = columns.find((c) => c.id === focusedColumnId);
    if (col) return col;
  }
  return columns[0];
}

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: 'chaos-sidepanel' });

  p.onMessage.addListener((msg: Record<string, unknown>) => {
    handlePortMessage(msg);
  });

  p.onDisconnect.addListener(() => {
    port = null;
    // Silently reconnect - service worker restarts are normal in MV3
    if (reconnectAttempts < MAX_RECONNECT_RETRIES) {
      const delay = Math.min(Math.pow(2, reconnectAttempts) * 500, 5000);
      reconnectAttempts++;
      setTimeout(() => {
        try {
          port = connectPort();
          reconnectAttempts = 0;
          // Silently refresh agent list
          sendPortMessage({ type: 'listAgents' });
        } catch {
          // Will be handled by next disconnect
        }
      }, delay);
    } else {
      // Only show a message after all retries fail
      const col = getFocusedColumn();
      if (col) addChatSystemMessageToColumn(col, 'Connection lost. Please reload the page.');
    }
  });

  return p;
}

function sendPortMessage(msg: Record<string, unknown>): void {
  if (!port) {
    port = connectPort();
  }
  port.postMessage(msg);
}

function handlePortMessage(msg: Record<string, unknown>): void {
  // Route chat-related messages to the correct column by agentId
  const msgAgentId = msg.agentId as string | undefined;

  switch (msg.type) {
    case 'agentList':
      onAgentListReceived(msg.agents as AgentMeta[]);
      break;

    case 'agentCreated': {
      const agent = msg.agent as AgentMeta;
      const col = getFocusedColumn();
      if (col) addChatSystemMessageToColumn(col, `Agent "${agent.name}" created.`);
      createAgentModal.classList.remove('visible');
      sendPortMessage({ type: 'listAgents' });
      activeAgentId = agent.id;
      break;
    }

    case 'agentDeleted':
      sendPortMessage({ type: 'listAgents' });
      // Remove column for deleted agent
      if (msgAgentId) {
        const col = getColumnForAgent(msgAgentId);
        if (col) removeColumn(col.id);
      }
      break;

    case 'chatStart': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        col.isStreaming = true;
        col.currentStreamContent = '';
        col.currentStreamEl = addChatAssistantMessageToColumn(col, '');
        col.typingEl.classList.add('visible');
        col.sendBtn.disabled = true;
      }
      break;
    }

    case 'chatChunk': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col && col.currentStreamEl) {
        col.currentStreamContent += msg.chunk as string;
        renderChatMarkdown(col.currentStreamEl, col.currentStreamContent);
        columnScrollToBottom(col);
      }
      break;
    }

    case 'toolCall': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        addToolCallCardToColumn(col, msg.name as string, msg.args as unknown, msg.result as unknown);
      }
      break;
    }

    case 'chatEnd': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        col.isStreaming = false;
        col.typingEl.classList.remove('visible');
        col.sendBtn.disabled = false;
        if (col.currentStreamEl && msg.fullResponse) {
          renderChatMarkdown(col.currentStreamEl, msg.fullResponse as string);
        }
        if (msg.fullResponse) {
          col.conversationHistory.push({
            role: 'assistant',
            content: msg.fullResponse as string,
            timestamp: new Date().toISOString(),
          });
          saveColumnConversation(col);
        }
        col.currentStreamEl = null;
        col.currentStreamContent = '';
        columnScrollToBottom(col);
      }
      break;
    }

    case 'chatError': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        col.isStreaming = false;
        col.typingEl.classList.remove('visible');
        col.sendBtn.disabled = false;
        if (col.currentStreamEl) {
          col.currentStreamEl.remove();
        }
        col.currentStreamEl = null;
        col.currentStreamContent = '';
        addChatErrorMessageToColumn(col, msg.error as string);
      }
      break;
    }

    case 'channelMessageReceived': {
      // Open a new column for the incoming channel message
      const agentId = msg.agentId as string;
      const channelLabel = msg.channelLabel as string || 'Channel';
      const from = msg.from as string || 'unknown';
      const content = msg.content as string || '';

      const col = addColumn(agentId, true);
      if (col) {
        // Rename the column header to show channel name
        const headerName = col.columnEl.querySelector('.column-agent-name');
        if (headerName) headerName.textContent = `${channelLabel}: ${from}`;

        // Show the incoming message
        const incomingEl = document.createElement('div');
        incomingEl.className = 'chat-message user-message';
        const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
        incomingEl.innerHTML = `<strong style="font-size:var(--text-xs);color:var(--text-muted);">${escapeHtml(from)} via ${escapeHtml(channelLabel)}</strong><br>${escapeHtml(preview)}`;
        col.messagesEl.appendChild(incomingEl);
        columnScrollToBottom(col);
        focusedColumnId = col.id;
      }
      break;
    }

    case 'agenticStart': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        col.isStreaming = true;
        col.typingEl.classList.add('visible');
        col.sendBtn.disabled = true;
        col.currentStepNumber = 0;
        col.currentProgressEntries = [];
      }
      break;
    }

    case 'agenticProgress': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (!col) break;

      const progressType = msg.progressType as string;
      const iteration = msg.iteration as number;
      const totalIterations = msg.totalIterations as number;
      const progressContent = msg.content as string;

      if (progressType === 'thinking') {
        // Start a new step if needed
        if (!col.currentStepDetails || iteration !== col.currentStepNumber) {
          // Close previous step
          if (col.currentStepDetails) {
            col.currentStepDetails.removeAttribute('open');
            finalizeStepSummary(col);
          }
          col.currentStepNumber = iteration;
          col.currentStepToolNames = [];
          col.currentStepStartTime = Date.now();

          // Record step-start in progress entries
          col.currentProgressEntries.push({
            type: 'step-start',
            stepNumber: iteration,
            timestamp: new Date().toISOString(),
          });

          // Create <details> element for this step
          const details = document.createElement('details');
          details.className = 'step-details';
          details.setAttribute('open', '');

          const summary = document.createElement('summary');
          summary.className = 'step-summary';
          summary.innerHTML = `<span class="step-badge">Step ${iteration}${totalIterations ? ' of ' + totalIterations : ''}</span><span class="step-status">working...</span>`;
          details.appendChild(summary);

          const content = document.createElement('div');
          content.className = 'step-content';
          details.appendChild(content);

          col.messagesEl.appendChild(details);
          col.currentStepDetails = details;
          col.currentStepContent = content;
          col.currentStepSummary = summary;

          // Create streaming element inside the step content
          const streamEl = document.createElement('div');
          streamEl.className = 'chat-message assistant thinking-stream active';
          content.appendChild(streamEl);
          col.currentStreamEl = streamEl;
          col.currentStreamContent = '';
        }

        if (!col.currentStreamEl && col.currentStepContent) {
          const streamEl = document.createElement('div');
          streamEl.className = 'chat-message assistant thinking-stream active';
          col.currentStepContent.appendChild(streamEl);
          col.currentStreamEl = streamEl;
          col.currentStreamContent = '';
        }

        // Record thinking in progress entries
        col.currentProgressEntries.push({
          type: 'thinking',
          stepNumber: iteration,
          content: progressContent,
          timestamp: new Date().toISOString(),
        });

        // Append the text delta
        col.currentStreamContent = (col.currentStreamContent || '') + progressContent;
        renderChatMarkdown(col.currentStreamEl!, col.currentStreamContent);
        columnScrollToBottom(col);
      } else if (progressType === 'tool-call') {
        // Remove active indicator from previous stream element
        if (col.currentStreamEl) {
          col.currentStreamEl.classList.remove('active');
        }
        col.currentStreamEl = null;
        col.currentStreamContent = '';

        const toolName = msg.toolName as string;
        const toolArgs = msg.toolArgs as Record<string, unknown> | undefined;

        // Track tool name for summary
        if (!col.currentStepToolNames.includes(toolName)) {
          col.currentStepToolNames.push(toolName);
          updateStepSummaryLive(col);
        }

        // Record in progress entries
        col.currentProgressEntries.push({
          type: 'tool-call',
          stepNumber: col.currentStepNumber,
          toolName,
          toolArgs,
          timestamp: new Date().toISOString(),
        });

        const toolEl = document.createElement('div');
        toolEl.className = 'agentic-tool-call';
        const nameEl = document.createElement('div');
        nameEl.className = 'agentic-tool-name';
        nameEl.textContent = toolName;
        toolEl.appendChild(nameEl);

        if (toolArgs) {
          for (const [k, v] of Object.entries(toolArgs)) {
            const val = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '...' : v) : JSON.stringify(v);
            const argEl = document.createElement('div');
            argEl.className = 'agentic-tool-arg';
            argEl.innerHTML = `<span class="agentic-tool-arg-key">${escapeHtml(k)}:</span> <span class="agentic-tool-arg-val">${escapeHtml(val)}</span>`;
            toolEl.appendChild(argEl);
          }
        }

        // Append into step content if available, otherwise messagesEl
        const container = col.currentStepContent || col.messagesEl;
        container.appendChild(toolEl);
        columnScrollToBottom(col);
      } else if (progressType === 'tool-result') {
        const resultContent = msg.toolResult as string | Record<string, unknown> | undefined;
        const toolName = msg.toolName as string || '';

        // Record in progress entries
        col.currentProgressEntries.push({
          type: 'tool-result',
          stepNumber: col.currentStepNumber,
          toolName,
          toolResult: resultContent,
          timestamp: new Date().toISOString(),
        });

        if (resultContent) {
          const fullText = typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent, null, 2);
          const preview = fullText.slice(0, 120);
          const hasMore = fullText.length > 120;

          const resultEl = document.createElement('div');
          resultEl.className = 'agentic-tool-result';

          const previewEl = document.createElement('div');
          previewEl.className = 'agentic-tool-result-preview';
          previewEl.innerHTML = `<span class="agentic-tool-result-label">\u2192 ${escapeHtml(toolName)}</span> ${escapeHtml(preview)}${hasMore ? '\u2026' : ''}${hasMore ? ' <span class="agentic-tool-result-toggle">\u25b6 expand</span>' : ''}`;
          resultEl.appendChild(previewEl);

          if (hasMore) {
            const fullEl = document.createElement('pre');
            fullEl.className = 'agentic-tool-result-full';
            fullEl.textContent = fullText;
            resultEl.appendChild(fullEl);

            previewEl.addEventListener('click', () => {
              const isOpen = fullEl.classList.contains('expanded');
              fullEl.classList.toggle('expanded');
              const toggle = previewEl.querySelector('.agentic-tool-result-toggle');
              if (toggle) toggle.textContent = isOpen ? '\u25b6 expand' : '\u25bc collapse';
            });
          }

          const container = col.currentStepContent || col.messagesEl;
          container.appendChild(resultEl);
          columnScrollToBottom(col);
        }
      } else if (progressType === 'text' && progressContent) {
        // Record in progress entries
        col.currentProgressEntries.push({
          type: 'text',
          stepNumber: col.currentStepNumber,
          content: progressContent,
          timestamp: new Date().toISOString(),
        });

        col.lastAgenticText = progressContent;
        // Finalize current step summary
        finalizeStepSummary(col);
        // Close the current step details
        if (col.currentStepDetails) {
          col.currentStepDetails.removeAttribute('open');
        }
        // Remove active streaming indicator
        if (col.currentStreamEl) {
          col.currentStreamEl.classList.remove('active');
        }
        col.currentStreamEl = null;
        col.currentStreamContent = '';
      } else if (progressType === 'step-complete') {
        // Subtle separator - finalize step
        finalizeStepSummary(col);
      } else if (progressType === 'error') {
        addChatErrorMessageToColumn(col, progressContent);
      }
      break;
    }

    case 'agenticDone': {
      const col = msgAgentId ? getColumnForAgent(msgAgentId) : getFocusedColumn();
      if (col) {
        col.isStreaming = false;
        col.typingEl.classList.remove('visible');
        col.sendBtn.disabled = false;
        // Finalize last step but keep it open so user can see the result
        finalizeStepSummary(col);
        // Don't close the last step - it contains the final work
        if (msg.result && (msg.result as string) !== col.lastAgenticText) {
          const finalEl = document.createElement('div');
          finalEl.className = 'chat-message assistant';
          renderChatMarkdown(finalEl, msg.result as string);
          col.messagesEl.appendChild(finalEl);
          columnScrollToBottom(col);
        }
        col.lastAgenticText = '';
        if (msg.result) {
          col.conversationHistory.push({
            role: 'assistant',
            content: msg.result as string,
            timestamp: new Date().toISOString(),
            progress: col.currentProgressEntries.length > 0 ? col.currentProgressEntries : undefined,
          });
          saveColumnConversation(col);
        }
        col.currentStreamEl = null;
        col.currentStreamContent = '';
        col.currentStepDetails = null;
        col.currentStepContent = null;
        col.currentStepSummary = null;
        col.currentStepToolNames = [];
        col.currentStepStartTime = null;
        col.currentStepNumber = 0;
        col.currentProgressEntries = [];
        columnScrollToBottom(col);
      }

      // If this was a "Run Now" scheduled task, update its run record
      if (pendingRunNowAlarmId) {
        const alarmId = pendingRunNowAlarmId;
        pendingRunNowAlarmId = null;
        sendMsg({ type: 'updateScheduledTaskRun', alarmId, result: ((msg.result as string) || '(no output)').slice(0, 200) })
          .then(() => { if (activeView === 'tasks') loadTasks(); })
          .catch(() => {});
      }
      break;
    }

    case 'extractedContent': {
      const col = getFocusedColumn();
      if (msg.content && col) {
        const content = msg.content as { title: string; url: string; content: string };
        col.pageContext = content;
        addChatSystemMessageToColumn(col, `Page content loaded: "${content.title}"`);
      } else if (col) {
        addChatSystemMessageToColumn(col, `Could not extract page content: ${msg.error || 'unknown error'}`);
      }
      break;
    }

    case 'apiKeys':
      // handled by settings
      break;

    case 'apiKeysSaved': {
      const col = getFocusedColumn();
      if (col) addChatSystemMessageToColumn(col, 'Settings saved.');
      break;
    }

    case 'conversationLoaded': {
      const loadedAgentId = msg.agentId as string | undefined;
      const col = loadedAgentId ? getColumnForAgent(loadedAgentId) : getFocusedColumn();
      if (col) {
        const loadedMessages = msg.messages as ConversationEntry[];
        col.conversationHistory = loadedMessages;
        col.messagesEl.innerHTML = '';
        for (const entry of loadedMessages) {
          if (entry.role === 'user') {
            addChatUserMessageToColumn(col, entry.content);
          } else if (entry.role === 'assistant') {
            // Render saved progress as collapsed <details> blocks before the response
            if (entry.progress && entry.progress.length > 0) {
              renderSavedProgress(col, entry.progress);
            }
            addChatAssistantMessageToColumn(col, entry.content);
          } else if (entry.role === 'system') {
            addChatSystemMessageToColumn(col, entry.content);
          }
        }
      }
      break;
    }

    case 'conversationSaved':
      break;

    case 'conversationCleared': {
      const clearAgentId = msg.agentId as string | undefined;
      const col = clearAgentId ? getColumnForAgent(clearAgentId) : getFocusedColumn();
      if (col) {
        col.conversationHistory = [];
        col.messagesEl.innerHTML = '';
        addChatSystemMessageToColumn(col, 'Conversation cleared.');
      }
      break;
    }

    case 'hooksList':
      renderHooksList(msg.hooks as Hook[]);
      break;

    case 'hookAdded':
    case 'hookUpdated':
    case 'hookRemoved':
      break;

    case 'error': {
      const col = getFocusedColumn();
      if (col) addChatSystemMessageToColumn(col, `Error: ${msg.error}`);
      break;
    }
  }
}

let hasRestoredFromHash = false;

function onAgentListReceived(agentList: AgentMeta[]): void {
  agents = agentList;
  renderAgentTabs();

  // On first load, restore state from URL hash
  if (!hasRestoredFromHash) {
    hasRestoredFromHash = true;
    const hashState = parseHash();
    if (hashState.view === 'global-settings') {
      // Trigger the global settings view directly (not via click)
      showGlobalSettings(false);
      return;
    }
    if (hashState.agentId && agents.find((a) => a.id === hashState.agentId)) {
      activeAgentId = hashState.agentId;
      activeView = hashState.view;
    }
  }

  // If we have an active agent, make sure it still exists
  if (activeAgentId && !agents.find((a) => a.id === activeAgentId)) {
    activeAgentId = null;
  }

  // If no active agent but agents exist, select the first one
  if (!activeAgentId && agents.length > 0) {
    activeAgentId = agents[0].id;
  }

  // Re-render tabs with correct active state
  renderAgentTabs();

  // Update sidebar active state to match activeView
  sidebarItems.forEach((b) => {
    b.classList.toggle('active', b.dataset.view === activeView);
  });

  // Update view visibility — but don't overwrite global settings if that's the active view
  if (activeAgentId && activeView !== 'global-settings') {
    updateViewVisibility();

    // Initialize columns if none exist
    if (columns.length === 0) {
      // Try restoring saved column config first
      restoreColumnConfig().then(() => {
        if (columns.length === 0) {
          initializeColumns();
        }
        // Auto-add columns for any agents not yet shown
        // (handles agents created by other sessions)
      });
    } else {
      // Update column headers in case agent names changed
      for (const col of columns) {
        const agent = agents.find((a) => a.id === col.agentId);
        if (agent) {
          const nameEl = col.columnEl.querySelector('.column-agent-name');
          if (nameEl) nameEl.textContent = agent.name;
        }
      }
    }

    loadCurrentViewData();
  } else {
    updateViewVisibility();
  }
}

// ── Column management ──

function addColumn(agentId: string, allowDuplicate = false): ChatColumn {
  // By default, reuse existing column for same agent (e.g. on restore)
  if (!allowDuplicate) {
    const existing = getColumnForAgent(agentId);
    if (existing) return existing;
  }

  const colId = `col-${agentId}-${Date.now()}`;

  // Build column DOM
  const columnEl = document.createElement('div');
  columnEl.className = 'chat-column';
  columnEl.dataset.columnId = colId;
  columnEl.dataset.agentId = agentId;

  const agent = agents.find((a) => a.id === agentId);
  const aName = agent ? agent.name : agentId;
  const aRole = agent ? (agent.master ? 'master' : agent.role) : 'agent';

  // Header
  const headerEl = document.createElement('div');
  headerEl.className = 'chat-column-header';
  headerEl.innerHTML = `
    <span class="column-agent-name">${escapeHtml(aName)}</span>
    <span class="role-badge ${roleBadgeClass(aRole)}">${escapeHtml(aRole)}</span>
    <button class="column-clear-btn" title="Clear conversation">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    </button>
    <button class="column-close-btn" title="Close column">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  columnEl.appendChild(headerEl);

  // Messages area
  const messagesEl = document.createElement('div');
  messagesEl.className = 'chat-messages';
  columnEl.appendChild(messagesEl);

  // Typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-typing';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  columnEl.appendChild(typingEl);

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'chat-input-area';

  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'chat-input-wrapper';

  // Mention dropdown per column
  const mentionDropdownEl = document.createElement('div');
  mentionDropdownEl.className = 'mention-dropdown';
  const mentionHeaderEl = document.createElement('div');
  mentionHeaderEl.className = 'mention-dropdown-header';
  const mentionListEl = document.createElement('ul');
  mentionListEl.className = 'mention-dropdown-list';
  mentionDropdownEl.appendChild(mentionHeaderEl);
  mentionDropdownEl.appendChild(mentionListEl);
  inputWrapper.appendChild(mentionDropdownEl);

  const textareaEl = document.createElement('textarea');
  textareaEl.placeholder = 'Type a message... (@ to mention)';
  textareaEl.rows = 1;
  inputWrapper.appendChild(textareaEl);

  const micBtn = document.createElement('button');
  micBtn.className = 'chat-btn-mic';
  micBtn.title = 'Voice input';
  micBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  inputWrapper.appendChild(micBtn);

  inputArea.appendChild(inputWrapper);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-btn-send';
  sendBtn.title = 'Send';
  sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  inputArea.appendChild(sendBtn);

  columnEl.appendChild(inputArea);

  // Build state object
  const clearBtn = headerEl.querySelector('.column-clear-btn') as HTMLButtonElement;
  const closeBtn = headerEl.querySelector('.column-close-btn') as HTMLButtonElement;

  const column: ChatColumn = {
    id: colId,
    agentId,
    messagesEl,
    inputEl: textareaEl,
    sendBtn,
    clearBtn,
    micBtn,
    typingEl,
    columnEl,
    mentionDropdown: mentionDropdownEl,
    mentionDropdownHeader: mentionHeaderEl,
    mentionDropdownList: mentionListEl,
    conversationHistory: [],
    isStreaming: false,
    currentStreamEl: null,
    currentStreamContent: '',
    lastAgenticText: '',
    pageContext: null,
    currentStepDetails: null,
    currentStepContent: null,
    currentStepSummary: null,
    currentStepToolNames: [],
    currentStepStartTime: null,
    currentStepNumber: 0,
    currentProgressEntries: [],
  };

  columns.push(column);

  // Insert before the [+] button
  const addBtn = columnsContainer.querySelector('.columns-add-btn');
  if (addBtn) {
    columnsContainer.insertBefore(columnEl, addBtn);
  } else {
    columnsContainer.appendChild(columnEl);
  }

  // Wire up event handlers
  sendBtn.addEventListener('click', () => sendColumnMessage(column));

  textareaEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !columnMentionVisible(column)) {
      e.preventDefault();
      sendColumnMessage(column);
    }
  });

  textareaEl.addEventListener('input', () => {
    columnAutoResize(column);
    handleColumnMentionInput(column);
  });

  textareaEl.addEventListener('focus', () => {
    focusedColumnId = colId;
  });

  textareaEl.addEventListener('keydown', (e) => {
    handleColumnMentionKeydown(column, e);
  });

  clearBtn.addEventListener('click', () => {
    sendPortMessage({ type: 'clearConversation', agentId: column.agentId });
  });

  closeBtn.addEventListener('click', () => {
    removeColumn(colId);
  });

  micBtn.addEventListener('click', () => {
    focusedColumnId = colId;
    toggleVoiceInput();
  });

  // Update layout classes
  updateColumnsLayout();

  // Load conversation (only for primary columns, not duplicates)
  if (port && !allowDuplicate) {
    sendPortMessage({ type: 'getConversation', agentId });
  }

  // Save column config
  saveColumnConfig();

  return column;
}

function removeColumn(columnId: string): void {
  const idx = columns.findIndex((c) => c.id === columnId);
  if (idx === -1) return;

  const col = columns[idx];
  col.columnEl.remove();
  columns.splice(idx, 1);

  if (focusedColumnId === columnId) {
    focusedColumnId = columns.length > 0 ? columns[0].id : null;
  }

  updateColumnsLayout();
  saveColumnConfig();
}

function updateColumnsLayout(): void {
  // Ensure [+] button exists
  if (!columnsContainer.querySelector('.columns-add-btn')) {
    const addBtn = document.createElement('button');
    addBtn.className = 'columns-add-btn';
    addBtn.title = 'Add chat column';
    addBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addBtn.addEventListener('click', (e) => {
      showColumnAddPicker(e);
    });
    columnsContainer.appendChild(addBtn);
  }

  // Set layout classes
  columnsContainer.classList.toggle('single-column', columns.length === 1);

  // When columns fit, use flex fill; when they overflow, use fixed width
  const totalMinWidth = columns.length * 400 + 48; // 48 for add button
  const containerWidth = columnsContainer.clientWidth;
  columnsContainer.classList.toggle('fit-columns', totalMinWidth <= containerWidth && columns.length > 1);
}

function showColumnAddPicker(e: MouseEvent): void {
  // Build the picker with agents not already shown
  const shownAgentIds = new Set(columns.map((c) => c.agentId));
  const available = agents.filter((a) => !shownAgentIds.has(a.id));

  columnAddPicker.innerHTML = '';

  // If only one agent, skip the picker and create immediately
  if (agents.length === 1) {
    addColumn(agents[0].id, true);
    return;
  }

  // Show all agents - multiple columns per agent are allowed
  for (const agent of agents) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span>${escapeHtml(agent.name)}</span><span class="picker-role">${escapeHtml(agent.master ? 'master' : agent.role)}</span>`;
    btn.addEventListener('click', () => {
      addColumn(agent.id, true);
      columnAddPicker.classList.remove('visible');
    });
    columnAddPicker.appendChild(btn);
  }

  // Position near the click
  columnAddPicker.style.left = `${e.clientX - 100}px`;
  columnAddPicker.style.top = `${e.clientY - 10}px`;
  columnAddPicker.classList.add('visible');

  // Close on outside click
  const close = (ev: MouseEvent) => {
    if (!columnAddPicker.contains(ev.target as Node)) {
      columnAddPicker.classList.remove('visible');
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function saveColumnConfig(): void {
  const config = columns.map((c) => c.agentId);
  chrome.storage.local.set({ 'chaos:columnConfig': config });
}

async function restoreColumnConfig(): Promise<void> {
  const result = await chrome.storage.local.get('chaos:columnConfig');
  const config = result['chaos:columnConfig'] as string[] | undefined;

  if (config && config.length > 0) {
    // Only restore columns for agents that still exist
    for (const agentId of config) {
      if (agents.find((a) => a.id === agentId) && !getColumnForAgent(agentId)) {
        addColumn(agentId);
      }
    }
  }
}

function initializeColumns(): void {
  // Clear existing columns
  for (const col of columns) {
    col.columnEl.remove();
  }
  columns = [];

  // Default: add column for active agent, or master agent
  if (activeAgentId) {
    addColumn(activeAgentId);
  } else if (agents.length > 0) {
    const master = agents.find((a) => a.master);
    addColumn(master ? master.id : agents[0].id);
  }

  updateColumnsLayout();
}

// ── Column-scoped chat message rendering ──

function addChatUserMessageToColumn(col: ChatColumn, text: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message user';
  const mentionPattern = /@(tab|bookmark|history|agent)\[[^\]]*\]\([^)]*\)/;
  if (mentionPattern.test(text)) {
    el.innerHTML = DOMPurify.sanitize(renderMentionBadges(escapeHtml(text)));
  } else {
    el.textContent = text;
  }
  col.messagesEl.appendChild(el);
  columnScrollToBottom(col);
}

function addChatAssistantMessageToColumn(col: ChatColumn, content: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'chat-message assistant';
  if (content) {
    renderChatMarkdown(el, content);
  }
  col.messagesEl.appendChild(el);
  columnScrollToBottom(col);
  return el;
}

function addChatSystemMessageToColumn(col: ChatColumn, text: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message system';
  el.textContent = text;
  col.messagesEl.appendChild(el);
  columnScrollToBottom(col);
}

function addChatErrorMessageToColumn(col: ChatColumn, error: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message error';
  el.textContent = `Error: ${error}`;
  col.messagesEl.appendChild(el);
  columnScrollToBottom(col);
}

function addToolCallCardToColumn(col: ChatColumn, name: string, args: unknown, result: unknown): void {
  const el = document.createElement('div');
  el.className = 'chat-message tool-call';

  const header = document.createElement('div');
  header.className = 'tool-call-header';

  const icon = document.createElement('span');
  icon.className = 'tool-call-icon';
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>';

  const label = document.createElement('span');
  label.className = 'tool-call-label';
  const argsStr = args && typeof args === 'object' ? JSON.stringify(args) : '';
  const shortArgs = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
  label.textContent = `${name}(${shortArgs})`;

  const toggle = document.createElement('span');
  toggle.className = 'tool-call-toggle';
  toggle.textContent = '\u25B6';

  header.appendChild(icon);
  header.appendChild(label);
  header.appendChild(toggle);

  const details = document.createElement('div');
  details.className = 'tool-call-details';

  const argsSection = document.createElement('div');
  argsSection.className = 'tool-call-section';
  argsSection.innerHTML = `<strong>Args:</strong> <pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>`;

  const resultSection = document.createElement('div');
  resultSection.className = 'tool-call-section';
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  resultSection.innerHTML = `<strong>Result:</strong> <pre>${escapeHtml(resultStr)}</pre>`;

  details.appendChild(argsSection);
  details.appendChild(resultSection);

  header.addEventListener('click', () => {
    el.classList.toggle('expanded');
    toggle.textContent = el.classList.contains('expanded') ? '\u25BC' : '\u25B6';
  });

  el.appendChild(header);
  el.appendChild(details);
  col.messagesEl.appendChild(el);
  columnScrollToBottom(col);
}

function renderChatMarkdown(el: HTMLDivElement, content: string): void {
  const rawHtml = marked.parse(content) as string;
  const sanitized = DOMPurify.sanitize(rawHtml);
  if (needsSandbox(rawHtml)) {
    el.innerHTML = '';
    renderInSandbox(sanitized, el);
  } else {
    el.innerHTML = sanitized;
  }
}

function columnScrollToBottom(col: ChatColumn): void {
  col.messagesEl.scrollTop = col.messagesEl.scrollHeight;
}

// ── Column-scoped send ──

function sendColumnMessage(col: ChatColumn): void {
  const text = col.inputEl.value.trim();
  if (!text || col.isStreaming) return;

  addChatUserMessageToColumn(col, text);
  col.inputEl.value = '';
  columnAutoResize(col);

  const entry: ConversationEntry = {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  };

  const chatMsg: Record<string, unknown> = {
    type: 'chat',
    agentId: col.agentId,
    message: text,
  };

  if (col.pageContext) {
    chatMsg.pageContext = col.pageContext;
    entry.pageContext = { title: col.pageContext.title, url: col.pageContext.url };
    col.pageContext = null;
  }

  col.conversationHistory.push(entry);
  sendPortMessage(chatMsg);
}

// ── Agentic step helpers ──

function updateStepSummaryLive(col: ChatColumn): void {
  if (!col.currentStepSummary) return;
  const statusEl = col.currentStepSummary.querySelector('.step-status');
  if (statusEl) {
    statusEl.textContent = col.currentStepToolNames.join(', ') + '...';
  }
}

function finalizeStepSummary(col: ChatColumn): void {
  if (!col.currentStepSummary || !col.currentStepStartTime) return;
  const elapsed = ((Date.now() - col.currentStepStartTime) / 1000).toFixed(1);
  const statusEl = col.currentStepSummary.querySelector('.step-status');
  if (statusEl) {
    const tools = col.currentStepToolNames.length > 0
      ? col.currentStepToolNames.join(', ') + ' \u2014 '
      : '';
    statusEl.textContent = `${tools}${elapsed}s`;
  }
}

function renderSavedProgress(col: ChatColumn, progress: AgenticProgressEntry[]): void {
  // Group progress entries into steps
  const steps: Map<number, AgenticProgressEntry[]> = new Map();
  for (const entry of progress) {
    const step = entry.stepNumber ?? 0;
    if (!steps.has(step)) steps.set(step, []);
    steps.get(step)!.push(entry);
  }

  for (const [stepNum, entries] of steps) {
    const toolNames: string[] = [];
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;

    for (const e of entries) {
      if (!firstTimestamp) firstTimestamp = e.timestamp;
      lastTimestamp = e.timestamp;
      if (e.type === 'tool-call' && e.toolName && !toolNames.includes(e.toolName)) {
        toolNames.push(e.toolName);
      }
    }

    const durationMs = firstTimestamp && lastTimestamp
      ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
      : 0;
    const durationStr = (durationMs / 1000).toFixed(1);
    const toolsStr = toolNames.length > 0 ? toolNames.join(', ') + ' \u2014 ' : '';

    const details = document.createElement('details');
    details.className = 'step-details';

    const summary = document.createElement('summary');
    summary.className = 'step-summary';
    summary.innerHTML = `<span class="step-badge">Step ${stepNum}</span><span class="step-status">${escapeHtml(toolsStr)}${durationStr}s</span>`;
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'step-content';

    // Consolidate consecutive thinking entries into a single block
    let accumulatedThinking = '';
    const flushThinking = () => {
      if (accumulatedThinking) {
        const thinkEl = document.createElement('div');
        thinkEl.className = 'chat-message assistant thinking-stream';
        renderChatMarkdown(thinkEl, accumulatedThinking);
        content.appendChild(thinkEl);
        accumulatedThinking = '';
      }
    };

    for (const e of entries) {
      if (e.type === 'thinking' && e.content) {
        accumulatedThinking += e.content;
        continue;
      }
      flushThinking();
      if (e.type === 'tool-call') {
        const toolEl = document.createElement('div');
        toolEl.className = 'agentic-tool-call';
        const nameEl = document.createElement('div');
        nameEl.className = 'agentic-tool-name';
        nameEl.textContent = e.toolName || '';
        toolEl.appendChild(nameEl);
        if (e.toolArgs && typeof e.toolArgs === 'object') {
          for (const [k, v] of Object.entries(e.toolArgs as Record<string, unknown>)) {
            const val = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '...' : v) : JSON.stringify(v);
            const argEl = document.createElement('div');
            argEl.className = 'agentic-tool-arg';
            argEl.innerHTML = `<span class="agentic-tool-arg-key">${escapeHtml(k)}:</span> <span class="agentic-tool-arg-val">${escapeHtml(val)}</span>`;
            toolEl.appendChild(argEl);
          }
        }
        content.appendChild(toolEl);
      } else if (e.type === 'tool-result' && e.toolResult) {
        const fullText = typeof e.toolResult === 'string' ? e.toolResult : JSON.stringify(e.toolResult, null, 2);
        const preview = fullText.slice(0, 120);
        const hasMore = fullText.length > 120;

        const resultEl = document.createElement('div');
        resultEl.className = 'agentic-tool-result';
        const previewEl = document.createElement('div');
        previewEl.className = 'agentic-tool-result-preview';
        previewEl.innerHTML = `<span class="agentic-tool-result-label">\u2192 ${escapeHtml(e.toolName || '')}</span> ${escapeHtml(preview)}${hasMore ? '\u2026' : ''}${hasMore ? ' <span class="agentic-tool-result-toggle">\u25b6 expand</span>' : ''}`;
        resultEl.appendChild(previewEl);

        if (hasMore) {
          const fullEl = document.createElement('pre');
          fullEl.className = 'agentic-tool-result-full';
          fullEl.textContent = fullText;
          resultEl.appendChild(fullEl);
          previewEl.addEventListener('click', () => {
            const isOpen = fullEl.classList.contains('expanded');
            fullEl.classList.toggle('expanded');
            const toggle = previewEl.querySelector('.agentic-tool-result-toggle');
            if (toggle) toggle.textContent = isOpen ? '\u25b6 expand' : '\u25bc collapse';
          });
        }
        content.appendChild(resultEl);
      }
    }
    flushThinking();

    details.appendChild(content);
    col.messagesEl.appendChild(details);
  }
}

function saveColumnConversation(col: ChatColumn): void {
  if (col.conversationHistory.length === 0) return;
  sendPortMessage({
    type: 'saveConversation',
    agentId: col.agentId,
    messages: col.conversationHistory,
  });
}

function columnAutoResize(col: ChatColumn): void {
  col.inputEl.style.height = 'auto';
  col.inputEl.style.height = Math.min(col.inputEl.scrollHeight, 160) + 'px';
}

// ── Chat voice input (iframe-based recognition) ──

let isRecording = false;
let recognitionIframe: HTMLIFrameElement | null = null;
let voiceFinalTranscript = '';

function toggleVoiceInput(): void {
  if (isRecording) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput(): void {
  if (isRecording) return;
  const col = getFocusedColumn();
  if (!col) return;
  isRecording = true;
  voiceFinalTranscript = '';
  col.inputEl.dataset.lastInterim = '';
  col.micBtn.classList.add('recording');

  // Create iframe pointing to recognition frame
  recognitionIframe = document.createElement('iframe');
  recognitionIframe.src = chrome.runtime.getURL('src/voice/recognition-frame.html');
  recognitionIframe.allow = 'microphone';
  const micRect = col.micBtn.getBoundingClientRect();
  recognitionIframe.style.cssText = `
    position: fixed;
    bottom: ${window.innerHeight - micRect.top + 8}px;
    right: ${window.innerWidth - micRect.right}px;
    width: 140px;
    height: 28px;
    border: none;
    border-radius: 6px;
    z-index: 10000;
    background: transparent;
  `;
  document.body.appendChild(recognitionIframe);
}

function stopVoiceInput(): void {
  if (!isRecording) return;
  isRecording = false;
  const col = getFocusedColumn();
  if (col) {
    col.micBtn.classList.remove('recording');
    delete col.inputEl.dataset.lastInterim;
  }

  if (recognitionIframe?.contentWindow) {
    recognitionIframe.contentWindow.postMessage(
      { target: 'chaos-recognition', type: 'stop' },
      '*'
    );
  }

  setTimeout(() => {
    if (recognitionIframe) {
      recognitionIframe.remove();
      recognitionIframe = null;
    }
  }, 200);

  voiceFinalTranscript = '';
}

// Listen for messages from the recognition iframe
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'chaos-recognition') return;
  const col = getFocusedColumn();

  switch (event.data.type) {
    case 'recognition-started':
      break;

    case 'recognition-result': {
      if (!col) break;
      const { finalTranscript, interimTranscript } = event.data;
      if (finalTranscript) {
        voiceFinalTranscript += finalTranscript + ' ';
      }
      const existingText = col.inputEl.value.substring(
        0,
        col.inputEl.value.length - (col.inputEl.dataset.lastInterim?.length || 0)
      );
      col.inputEl.value = existingText + voiceFinalTranscript + (interimTranscript || '');
      col.inputEl.dataset.lastInterim = interimTranscript || '';
      col.inputEl.scrollTop = col.inputEl.scrollHeight;
      break;
    }

    case 'recognition-error':
      if (!event.data.recoverable) {
        if (col) addChatSystemMessageToColumn(col, `Speech recognition error: ${event.data.error}`);
        stopVoiceInput();
      }
      break;

    case 'recognition-ended':
      if (isRecording) {
        isRecording = false;
        if (col) {
          col.micBtn.classList.remove('recording');
          delete col.inputEl.dataset.lastInterim;
        }
        if (recognitionIframe) {
          recognitionIframe.remove();
          recognitionIframe = null;
        }
        voiceFinalTranscript = '';
      }
      break;
  }
});

// Listen for messages from background (hotkeys, context menu actions)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'toggle-voice-input') {
    toggleVoiceInput();
  }

  if (msg?.type === 'contextMenuAction') {
    const { agentId, content, hookPrompt } = msg as {
      agentId: string;
      content: string;
      hookPrompt?: string;
    };

    // Switch to chat view
    activeView = 'chat';
    document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === 'chat');
    });
    updateViewVisibility();

    // Create a new column for this agent (allow duplicate so it doesn't clobber existing chats)
    const col = addColumn(agentId, true);
    if (!col) return;

    // Show the context and prompt as visible messages so the user knows what was sent
    const contentPreview = content.length > 300 ? content.slice(0, 300) + '...' : content;
    if (hookPrompt) {
      // Show the hook prompt as a user message so the user can see what's being asked
      const userMsg = document.createElement('div');
      userMsg.className = 'chat-message user';
      renderChatMarkdown(userMsg, `**Hook:** ${hookPrompt}\n\n**Content:** ${contentPreview}`);
      col.messagesEl.appendChild(userMsg);
    } else {
      const userMsg = document.createElement('div');
      userMsg.className = 'chat-message user';
      renderChatMarkdown(userMsg, `**Sent via context menu:**\n\n${contentPreview}`);
      col.messagesEl.appendChild(userMsg);
    }
    columnScrollToBottom(col);

    // Build the task message
    const task = hookPrompt
      ? `[Context menu hook]\n\nUser-provided content:\n${content}\n\nInstructions: ${hookPrompt}`
      : `The user sent you this content via context menu:\n\n${content}`;

    // Mark this column as the active target for this agent's responses
    focusedColumnId = col.id;

    // Send the agentic chat message through the port
    sendPortMessage({
      type: 'agenticChat',
      agentId,
      message: task,
      columnId: col.id,
    });
  }
});

// ══════════════════════════════════════════
// ── Mention Autocomplete (per-column)
// ══════════════════════════════════════════

interface MentionItem {
  type: 'tab' | 'bookmark' | 'history' | 'agent';
  title: string;
  subtitle: string;
  value: string;
  id: string;
}

// Per-column mention state
let mentionActiveColumn: ChatColumn | null = null;
let mentionItems: MentionItem[] = [];
let mentionActiveIndex = -1;
let mentionStartPos = -1;

const MENTION_CATEGORIES = ['tab', 'bookmark', 'history', 'agent'] as const;
type MentionCategory = typeof MENTION_CATEGORIES[number];

const MENTION_ICONS: Record<MentionCategory, string> = {
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

const MENTION_LABELS: Record<MentionCategory, string> = {
  tab: 'Tabs',
  bookmark: 'Bookmarks',
  history: 'History',
  agent: 'Agents',
};

function columnMentionVisible(col: ChatColumn): boolean {
  return mentionActiveColumn === col && col.mentionDropdown.classList.contains('visible');
}

function parseMentionQueryForColumn(col: ChatColumn): { category: MentionCategory | null; filter: string; start: number } | null {
  const cursorPos = col.inputEl.selectionStart;
  const text = col.inputEl.value;

  let atPos = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      if (i === 0 || /\s/.test(text[i - 1])) {
        atPos = i;
      }
      break;
    }
    if (ch === '\n') break;
  }

  if (atPos === -1) return null;

  const afterAt = text.slice(atPos + 1, cursorPos);

  for (const cat of MENTION_CATEGORIES) {
    if (afterAt.toLowerCase() === cat.slice(0, afterAt.length) && afterAt.length <= cat.length && !afterAt.includes(' ')) {
      return { category: null, filter: afterAt, start: atPos };
    }
    if (afterAt.toLowerCase().startsWith(cat + ' ') || afterAt.toLowerCase() === cat) {
      const filter = afterAt.slice(cat.length).trimStart();
      return { category: cat as MentionCategory, filter, start: atPos };
    }
  }

  if (afterAt === '') {
    return { category: null, filter: '', start: atPos };
  }

  const matchesAnyPrefix = MENTION_CATEGORIES.some(cat =>
    cat.startsWith(afterAt.toLowerCase())
  );
  if (matchesAnyPrefix) {
    return { category: null, filter: afterAt, start: atPos };
  }

  return null;
}

async function fetchMentionItems(category: MentionCategory, filter: string): Promise<MentionItem[]> {
  const items: MentionItem[] = [];
  const query = filter.toLowerCase();

  switch (category) {
    case 'tab': {
      const hasTabs = await hasPermission('tabs');
      if (!hasTabs) return [{
        type: 'tab',
        title: 'Enable tabs permission in settings',
        subtitle: 'Required to list open tabs',
        value: '',
        id: '__permission__',
      }];
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (!tab.title && !tab.url) continue;
          const title = tab.title || 'Untitled';
          const url = tab.url || '';
          if (query && !title.toLowerCase().includes(query) && !url.toLowerCase().includes(query)) continue;
          items.push({ type: 'tab', title, subtitle: url, value: `@tab[${title}](${tab.id})`, id: String(tab.id) });
        }
      } catch { /* permission denied or API error */ }
      break;
    }
    case 'bookmark': {
      const hasBookmarks = await hasPermission('bookmarks');
      if (!hasBookmarks) return [{
        type: 'bookmark',
        title: 'Enable bookmarks permission in settings',
        subtitle: 'Required to search bookmarks',
        value: '',
        id: '__permission__',
      }];
      try {
        const results = await chrome.bookmarks.search(filter || ' ');
        for (const bm of results) {
          if (!bm.url) continue;
          const title = bm.title || 'Untitled';
          items.push({ type: 'bookmark', title, subtitle: bm.url, value: `@bookmark[${title}](${bm.url})`, id: bm.url });
        }
      } catch { /* permission denied or API error */ }
      break;
    }
    case 'history': {
      const hasHistory = await hasPermission('history');
      if (!hasHistory) return [{
        type: 'history',
        title: 'Enable history permission in settings',
        subtitle: 'Required to search history',
        value: '',
        id: '__permission__',
      }];
      try {
        const results = await chrome.history.search({ text: filter || '', maxResults: 20, startTime: Date.now() - 7 * 24 * 60 * 60 * 1000 });
        for (const item of results) {
          if (!item.url) continue;
          const title = item.title || 'Untitled';
          if (query && !title.toLowerCase().includes(query) && !item.url.toLowerCase().includes(query)) continue;
          items.push({ type: 'history', title, subtitle: item.url, value: `@history[${title}](${item.url})`, id: item.url });
        }
      } catch { /* permission denied or API error */ }
      break;
    }
    case 'agent': {
      for (const agent of agents) {
        const title = agent.name;
        const subtitle = agent.role;
        if (query && !title.toLowerCase().includes(query) && !subtitle.toLowerCase().includes(query)) continue;
        items.push({ type: 'agent', title, subtitle, value: `@agent[${title}](${agent.id})`, id: agent.id });
      }
      break;
    }
  }

  return items.slice(0, 8);
}

function showColumnMentionDropdown(col: ChatColumn, items: MentionItem[], category: MentionCategory | null): void {
  mentionActiveColumn = col;
  mentionItems = items;
  mentionActiveIndex = items.length > 0 ? 0 : -1;

  if (category) {
    col.mentionDropdownHeader.innerHTML = `${MENTION_ICONS[category]}<span>${MENTION_LABELS[category]}</span>`;
  } else {
    col.mentionDropdownHeader.innerHTML = `<span>Type a category: tab, bookmark, history, agent</span>`;
  }
  col.mentionDropdownHeader.style.display = '';

  col.mentionDropdownList.innerHTML = '';

  if (items.length === 0 && category) {
    const emptyEl = document.createElement('li');
    emptyEl.className = 'mention-dropdown-empty';
    emptyEl.textContent = 'No results found';
    col.mentionDropdownList.appendChild(emptyEl);
  } else if (!category) {
    for (const cat of MENTION_CATEGORIES) {
      const li = document.createElement('li');
      li.className = 'mention-dropdown-item';
      li.innerHTML = `
        <span class="mention-icon type-${cat}">${MENTION_ICONS[cat]}</span>
        <span class="mention-info">
          <span class="mention-title">${MENTION_LABELS[cat]}</span>
          <span class="mention-subtitle">Type @${cat} to search</span>
        </span>
      `;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertColumnCategoryText(col, cat);
      });
      col.mentionDropdownList.appendChild(li);
    }
    const firstItem = col.mentionDropdownList.querySelector('.mention-dropdown-item');
    if (firstItem) firstItem.classList.add('active');
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const li = document.createElement('li');
      li.className = 'mention-dropdown-item' + (i === mentionActiveIndex ? ' active' : '');
      li.innerHTML = `
        <span class="mention-icon type-${item.type}">${MENTION_ICONS[item.type]}</span>
        <span class="mention-info">
          <span class="mention-title">${escapeHtml(item.title)}</span>
          <span class="mention-subtitle">${escapeHtml(item.subtitle)}</span>
        </span>
      `;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectColumnMentionItem(col, item);
      });
      li.addEventListener('mouseenter', () => {
        mentionActiveIndex = i;
        updateColumnMentionActiveItem(col);
      });
      col.mentionDropdownList.appendChild(li);
    }
  }

  col.mentionDropdown.classList.add('visible');
}

function hideColumnMentionDropdown(col: ChatColumn): void {
  mentionItems = [];
  mentionActiveIndex = -1;
  mentionStartPos = -1;
  mentionActiveColumn = null;
  col.mentionDropdown.classList.remove('visible');
}

function updateColumnMentionActiveItem(col: ChatColumn): void {
  const items = col.mentionDropdownList.querySelectorAll('.mention-dropdown-item');
  items.forEach((el, i) => {
    el.classList.toggle('active', i === mentionActiveIndex);
  });
  const activeEl = col.mentionDropdownList.querySelector('.mention-dropdown-item.active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function insertColumnCategoryText(col: ChatColumn, category: MentionCategory): void {
  if (mentionStartPos === -1) return;
  const before = col.inputEl.value.slice(0, mentionStartPos);
  const after = col.inputEl.value.slice(col.inputEl.selectionStart);
  col.inputEl.value = before + '@' + category + ' ' + after;
  const newCursorPos = mentionStartPos + 1 + category.length + 1;
  col.inputEl.selectionStart = newCursorPos;
  col.inputEl.selectionEnd = newCursorPos;
  col.inputEl.focus();
  handleColumnMentionInput(col);
}

function selectColumnMentionItem(col: ChatColumn, item: MentionItem): void {
  if (item.id === '__permission__' || !item.value) {
    hideColumnMentionDropdown(col);
    return;
  }

  if (mentionStartPos === -1) return;
  const before = col.inputEl.value.slice(0, mentionStartPos);
  const after = col.inputEl.value.slice(col.inputEl.selectionStart);
  col.inputEl.value = before + item.value + ' ' + after;
  const newCursorPos = mentionStartPos + item.value.length + 1;
  col.inputEl.selectionStart = newCursorPos;
  col.inputEl.selectionEnd = newCursorPos;
  col.inputEl.focus();
  columnAutoResize(col);
  hideColumnMentionDropdown(col);
}

let mentionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

async function handleColumnMentionInput(col: ChatColumn): Promise<void> {
  const query = parseMentionQueryForColumn(col);

  if (!query) {
    hideColumnMentionDropdown(col);
    return;
  }

  mentionStartPos = query.start;

  if (!query.category) {
    const filtered = MENTION_CATEGORIES.filter(cat =>
      !query.filter || cat.startsWith(query.filter.toLowerCase())
    );

    if (filtered.length === 0) {
      hideColumnMentionDropdown(col);
      return;
    }

    showColumnMentionDropdown(col, [], null);
    const listItems = col.mentionDropdownList.querySelectorAll('.mention-dropdown-item');
    listItems.forEach((li, idx) => {
      const cat = MENTION_CATEGORIES[idx];
      (li as HTMLElement).style.display = filtered.includes(cat) ? '' : 'none';
    });
    mentionActiveIndex = MENTION_CATEGORIES.indexOf(filtered[0]);
    updateColumnMentionActiveItem(col);
    return;
  }

  if (mentionDebounceTimer) clearTimeout(mentionDebounceTimer);
  mentionDebounceTimer = setTimeout(async () => {
    const items = await fetchMentionItems(query.category!, query.filter);
    const currentQuery = parseMentionQueryForColumn(col);
    if (!currentQuery || currentQuery.category !== query.category) return;
    showColumnMentionDropdown(col, items, query.category);
  }, 150);
}

function handleColumnMentionKeydown(col: ChatColumn, e: KeyboardEvent): void {
  if (!columnMentionVisible(col)) return;

  const allItems = col.mentionDropdownList.querySelectorAll('.mention-dropdown-item');
  const visibleItems = Array.from(allItems).filter(el => (el as HTMLElement).style.display !== 'none');
  const visibleCount = visibleItems.length;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (visibleCount > 0) {
      const currentVisibleIdx = visibleItems.findIndex((_, i) => {
        const allIdx = Array.from(allItems).indexOf(visibleItems[i]);
        return allIdx === mentionActiveIndex;
      });
      const nextVisibleIdx = (currentVisibleIdx + 1) % visibleCount;
      mentionActiveIndex = Array.from(allItems).indexOf(visibleItems[nextVisibleIdx]);
      updateColumnMentionActiveItem(col);
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (visibleCount > 0) {
      const currentVisibleIdx = visibleItems.findIndex((_, i) => {
        const allIdx = Array.from(allItems).indexOf(visibleItems[i]);
        return allIdx === mentionActiveIndex;
      });
      const prevVisibleIdx = (currentVisibleIdx - 1 + visibleCount) % visibleCount;
      mentionActiveIndex = Array.from(allItems).indexOf(visibleItems[prevVisibleIdx]);
      updateColumnMentionActiveItem(col);
    }
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const activeItem = col.mentionDropdownList.querySelector('.mention-dropdown-item.active') as HTMLElement | null;
    if (activeItem) {
      activeItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideColumnMentionDropdown(col);
  }
}

// Close dropdown when clicking outside
document.addEventListener('mousedown', (e) => {
  if (mentionActiveColumn) {
    const col = mentionActiveColumn;
    if (columnMentionVisible(col) && !col.mentionDropdown.contains(e.target as Node) && e.target !== col.inputEl) {
      hideColumnMentionDropdown(col);
    }
  }
});

// ── Mention badge rendering ──

const MENTION_BADGE_ICONS: Record<string, string> = {
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

/** Replace @type[title](id) patterns with styled mention badges */
function renderMentionBadges(text: string): string {
  return text.replace(
    /@(tab|bookmark|history|agent)\[([^\]]*)\]\(([^)]*)\)/g,
    (_match, type: string, title: string, _id: string) => {
      const icon = MENTION_BADGE_ICONS[type] || '';
      return `<span class="mention-badge type-${escapeHtml(type)}">${icon}${escapeHtml(title)}</span>`;
    }
  );
}

// ── Agent filter helper (shared views) ──

function populateAgentFilter(selectId: string): string {
  const select = document.getElementById(selectId) as HTMLSelectElement;
  if (!select) return '';
  const current = select.value;
  // Keep first "All agents" option, rebuild the rest
  select.innerHTML = '<option value="">All agents</option>';
  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = agent.name + (agent.master ? ' \u2605' : '');
    select.appendChild(opt);
  }
  select.value = current; // restore selection
  return select.value;
}

// ══════════════════════════════════════════
// ── Tasks View
// ══════════════════════════════════════════

async function loadTasks(): Promise<void> {
  showPanelLoading('view-tasks');
  try {
    const [collabResult, schedResult] = await Promise.all([
      sendMsg<{ tasks: Task[] }>({ type: 'getTaskState' }),
      sendMsg<{ tasks: ScheduledTask[] }>({ type: 'getScheduledTasks' }),
    ]);
    tasks = collabResult.tasks;
    scheduledTasks = schedResult.tasks || [];
    renderTasks();
  } catch (err) {
    showPanelError('view-tasks', `Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('view-tasks');
  }
}

function renderTasks(): void {
  const container = document.getElementById('tasks-unified-content')!;
  const empty = document.getElementById('tasks-empty')!;

  // Populate and read agent filter
  const filterAgentId = populateAgentFilter('tasks-filter-agent');

  // Filter scheduled tasks - show all or filtered by agent
  const agentScheduled = filterAgentId
    ? scheduledTasks.filter((t) => t.agentId === filterAgentId)
    : scheduledTasks;

  // Filter collaborative tasks - show all or filtered by agent
  const filterStatus = (document.getElementById('tasks-filter-status') as HTMLSelectElement).value;
  let agentCollab = filterAgentId
    ? tasks.filter((t) => t.owner === filterAgentId)
    : tasks;
  if (filterStatus) {
    agentCollab = agentCollab.filter((t) => t.status === filterStatus);
  }

  // Show global empty state if both are empty
  if (agentScheduled.length === 0 && agentCollab.length === 0 && !filterStatus) {
    container.style.display = 'none';
    empty.style.display = '';
    return;
  }

  container.style.display = '';
  empty.style.display = 'none';

  let html = '';

  // ── Scheduled Tasks section ──
  html += `<div class="tasks-section">`;
  html += `<div class="tasks-section-header">
    <h3>Scheduled Tasks</h3>
    <p class="tasks-section-subtitle">Recurring and one-shot tasks this agent runs automatically</p>
  </div>`;

  if (agentScheduled.length === 0) {
    html += `<p class="tasks-section-empty">No scheduled tasks. Ask your agent to do something on a timer, like "check my bookmarks every morning".</p>`;
  } else {
    html += agentScheduled.map((t) => {
      const scheduleLabel = t.schedule.type === 'recurring'
        ? `Every ${formatDuration(t.schedule.periodInMinutes || 0)}`
        : 'One-shot';
      // Build the expandable details panel
      let detailsContent = '';
      if (t.runHistory && t.runHistory.length > 0) {
        detailsContent = `<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Run History (${t.runHistory.length})</div>` +
          t.runHistory.slice().reverse().map((run) => `
            <div style="margin-bottom:12px;padding:8px;background:var(--bg-surface);border-radius:6px;border:1px solid var(--border-subtle);">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${formatTimeFull(run.timestamp)}${run.durationMs ? ` (${Math.round(run.durationMs / 1000)}s)` : ''}</div>
              <div style="font-size:13px;color:var(--text-primary);line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapeHtml(run.result)}</div>
            </div>
          `).join('');
      } else if (t.lastResult) {
        // Fallback: show lastResult for tasks created before runHistory existed
        detailsContent = `<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Last Result</div>
          <div style="padding:8px;background:var(--bg-surface);border-radius:6px;border:1px solid var(--border-subtle);">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${t.lastRunAt ? formatTimeFull(t.lastRunAt) : ''}</div>
            <div style="font-size:13px;color:var(--text-primary);line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapeHtml(t.lastResult)}</div>
          </div>`;
      }
      const runHistoryHtml = detailsContent
        ? `<div class="task-run-history" style="display:none;margin-top:8px;border-top:1px solid var(--border-subtle);padding-top:8px;">${detailsContent}</div>`
        : '';

      return `
      <div class="scheduled-task-item" data-alarm-id="${escapeHtml(t.alarmId)}">
        <div class="scheduled-task-info">
          <div class="task-desc">${escapeHtml(t.description)}</div>
          <div class="task-schedule-badge"><span class="badge badge-info">${escapeHtml(scheduleLabel)}</span> <span class="badge badge-active">Active</span>${t.runHistory?.length ? ` <span class="badge" style="background:var(--bg-surface);color:var(--text-secondary);">${t.runHistory.length} runs</span>` : ''}</div>
          <div class="task-prompt">${escapeHtml(t.prompt.slice(0, 120))}${t.prompt.length > 120 ? '...' : ''}</div>
          ${t.lastRunAt ? `<div class="task-last-run" style="${detailsContent ? 'cursor:pointer;' : ''}" ${detailsContent ? 'data-toggle-history="true"' : ''}>Last run: ${formatTimeFull(t.lastRunAt)}${t.lastResult ? ' — ' + escapeHtml(t.lastResult.slice(0, 80)) + (t.lastResult.length > 80 ? '...' : '') : ''}${detailsContent ? ' <span style="color:var(--accent-text);font-size:11px;">▼ show details</span>' : ''}</div>` : '<div style="font-size:12px;color:var(--text-muted);">Not run yet</div>'}
          ${runHistoryHtml}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" data-run-task="${escapeHtml(t.alarmId)}">Run Now</button>
          <button class="btn btn-danger btn-sm" data-cancel-task="${escapeHtml(t.alarmId)}">Cancel</button>
        </div>
      </div>`;
    }).join('');
  }
  html += `</div>`;

  // ── Collaborative Tasks section ──
  html += `<div class="tasks-section">`;
  html += `<div class="tasks-section-header">
    <h3>Collaborative Tasks</h3>
    <p class="tasks-section-subtitle">Tasks created for or by this agent in the shared task board</p>
  </div>`;

  if (agentCollab.length === 0) {
    const reason = tasks.filter((t) => t.owner === activeAgentId).length === 0
      ? 'No collaborative tasks yet. These appear when agents create work items for each other.'
      : 'No tasks match the current filters.';
    html += `<p class="tasks-section-empty">${reason}</p>`;
  } else {
    html += `<table class="data-table" id="tasks-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Agent</th>
          <th>Status</th>
          <th>Dependencies</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>`;
    html += agentCollab.map((t) => `
      <tr class="clickable" data-task-id="${escapeHtml(t.id)}">
        <td>${escapeHtml(t.subject)}</td>
        <td>${t.owner ? escapeHtml(agentName(t.owner)) : '<span style="color:var(--text-muted)">Unassigned</span>'}</td>
        <td><span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(t.status.replace('_', ' '))}</span></td>
        <td>${t.blockedBy && t.blockedBy.length > 0 ? t.blockedBy.map((id) => escapeHtml(taskSubject(id))).join(', ') : '<span style="color:var(--text-muted)">None</span>'}</td>
        <td class="col-time">${formatTime(t.createdAt)}</td>
        <td class="col-time">${formatTime(t.updatedAt)}</td>
      </tr>`).join('');
    html += `</tbody></table>`;
  }
  html += `</div>`;

  container.innerHTML = html;

  // Wire up cancel buttons for scheduled tasks
  container.querySelectorAll<HTMLButtonElement>('[data-cancel-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const alarmId = btn.dataset.cancelTask!;
      await sendMsg({ type: 'cancelScheduledTask', alarmId });
      loadTasks();
    });
  });

  // Wire up click-to-expand and history toggle for scheduled tasks
  container.querySelectorAll<HTMLDivElement>('.scheduled-task-item').forEach((item) => {
    // Toggle run history on "show details" click
    const historyToggle = item.querySelector('[data-toggle-history]');
    const historyPanel = item.querySelector('.task-run-history') as HTMLDivElement | null;
    if (historyToggle && historyPanel) {
      historyToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = historyPanel.style.display !== 'none';
        historyPanel.style.display = isVisible ? 'none' : 'block';
        const arrow = historyToggle.querySelector('span');
        if (arrow) arrow.textContent = isVisible ? '▼ show details' : '▲ hide details';
      });
    }

    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-cancel-task]') || (e.target as HTMLElement).closest('[data-run-task]') || (e.target as HTMLElement).closest('[data-toggle-history]')) return;
      item.classList.toggle('expanded');
    });

    // Run Now button — switch to chat view and stream via agenticChat
    const runBtn = item.querySelector<HTMLButtonElement>('[data-run-task]');
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        const alarmId = runBtn.dataset.runTask!;
        const task = scheduledTasks.find((t) => t.alarmId === alarmId);
        if (!task) return;

        // Switch to chat view and create a NEW column for this task
        activeView = 'chat';
        sidebarItems.forEach((b) => {
          b.classList.toggle('active', b.dataset.view === 'chat');
        });
        updateViewVisibility();

        // Create a new column (allow duplicate) so it doesn't interfere with existing conversations
        const runCol = addColumn(task.agentId, true);
        if (runCol) addChatSystemMessageToColumn(runCol, `Running scheduled task: ${task.description}`);

        // Track this so the agenticDone handler can update the task record
        pendingRunNowAlarmId = alarmId;

        // Send via port-based agenticChat so progress streams into the chat
        sendPortMessage({
          type: 'agenticChat',
          agentId: task.agentId,
          message: task.prompt,
        });
      });
    }
  });

  // Wire up collaborative task rows
  container.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((row) => {
    row.addEventListener('click', () => {
      showTaskDetail(row.dataset.taskId!);
    });
  });
}

function taskSubject(taskId: string): string {
  const t = tasks.find((task) => task.id === taskId);
  return t ? t.subject : taskId;
}

function showTaskDetail(taskId: string): void {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('task-detail-modal')!;
  const content = document.getElementById('task-detail-content')!;

  content.innerHTML = `
    <h2>${escapeHtml(task.subject)}</h2>
    <div class="task-detail-field">
      <div class="task-detail-label">Status</div>
      <div class="task-detail-value"><span class="badge ${statusBadgeClass(task.status)}">${escapeHtml(task.status.replace('_', ' '))}</span></div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Owner</div>
      <div class="task-detail-value">${task.owner ? escapeHtml(agentName(task.owner)) : 'Unassigned'}</div>
    </div>
    ${task.description ? `<div class="task-detail-field"><div class="task-detail-label">Description</div><div class="task-detail-value">${escapeHtml(task.description)}</div></div>` : ''}
    ${task.result ? `<div class="task-detail-field"><div class="task-detail-label">Result</div><div class="task-detail-value">${escapeHtml(task.result)}</div></div>` : ''}
    ${task.blockedBy && task.blockedBy.length > 0 ? `<div class="task-detail-field"><div class="task-detail-label">Blocked By</div><div class="task-detail-value">${task.blockedBy.map((id) => escapeHtml(taskSubject(id))).join(', ')}</div></div>` : ''}
    <div class="task-detail-field">
      <div class="task-detail-label">Created</div>
      <div class="task-detail-value">${formatTimeFull(task.createdAt)}</div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Updated</div>
      <div class="task-detail-value">${formatTimeFull(task.updatedAt)}</div>
    </div>
  `;

  modal.classList.add('visible');
}

document.getElementById('tasks-filter-status')!.addEventListener('change', renderTasks);
document.getElementById('tasks-filter-agent')!.addEventListener('change', renderTasks);

document.getElementById('task-detail-close')!.addEventListener('click', () => {
  document.getElementById('task-detail-modal')!.classList.remove('visible');
});

document.getElementById('task-detail-modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('task-detail-modal')) {
    document.getElementById('task-detail-modal')!.classList.remove('visible');
  }
});

// ══════════════════════════════════════════
// ── Messages View
// ══════════════════════════════════════════

async function loadMessages(): Promise<void> {
  showPanelLoading('view-messages');
  try {
    const result = await sendMsg<{ messages: AgentMessage[] }>({ type: 'getMessages' });
    messages = result.messages;
    renderMessages();
  } catch (err) {
    showPanelError('view-messages', `Failed to load messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('view-messages');
  }
}

function renderMessages(): void {
  const list = document.getElementById('message-list')!;
  const empty = document.getElementById('messages-empty')!;

  const searchText = (document.getElementById('messages-search') as HTMLInputElement).value
    .toLowerCase()
    .trim();

  // Populate and read agent filter
  const filterAgentId = populateAgentFilter('messages-filter-agent');

  // Filter by agent (show all by default)
  let filtered = filterAgentId
    ? messages.filter((m) => m.from === filterAgentId || m.to === filterAgentId)
    : messages;
  if (searchText) {
    filtered = filtered.filter((m) => m.body.toLowerCase().includes(searchText));
  }

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.textContent = messages.length === 0
      ? 'No messages yet. This is the inter-agent communication log. When agents are set to "visible" or "open" visibility, they can send messages to each other. You can also ask an agent to message another agent directly.'
      : 'No messages match the current filters.';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';

  list.innerHTML = filtered
    .map(
      (m) => `
    <div class="msg-item${m.to === 'broadcast' ? ' broadcast' : ''}">
      <div class="msg-item-header">
        <span class="msg-from">${escapeHtml(agentName(m.from))}</span>
        <span class="badge ${roleBadgeClass(agentRole(m.from))}" style="font-size:10px;">${escapeHtml(agentRole(m.from))}</span>
        <span class="msg-arrow">&rarr;</span>
        <span class="msg-to">${m.to === 'broadcast' ? 'broadcast' : escapeHtml(agentName(m.to))}</span>
        <span class="msg-time">${formatTime(m.timestamp)}</span>
      </div>
      <div class="msg-body">${escapeHtml(m.body)}</div>
    </div>
  `,
    )
    .join('');

  list.scrollTop = list.scrollHeight;
}

document.getElementById('messages-search')!.addEventListener('input', renderMessages);
document.getElementById('messages-filter-agent')!.addEventListener('change', renderMessages);

// ══════════════════════════════════════════
// ── Artifacts View
// ══════════════════════════════════════════

async function loadArtifacts(): Promise<void> {
  showPanelLoading('view-artifacts');
  try {
    const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
    artifacts = result.artifacts;
    renderArtifacts();
  } catch (err) {
    showPanelError('view-artifacts', `Failed to load artifacts: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('view-artifacts');
  }
}

function renderArtifacts(): void {
  const grid = document.getElementById('artifact-grid')!;
  const empty = document.getElementById('artifacts-empty')!;

  // Populate and read agent filter
  const filterAgentId = populateAgentFilter('artifacts-filter-agent');

  // Filter by agent (show all by default)
  const filtered = filterAgentId
    ? artifacts.filter((a) => a.agentId === filterAgentId)
    : artifacts;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.textContent = 'No shared artifacts yet. Artifacts are files that an agent publishes to the shared space for other agents to read. Ask an agent to "publish" or "share" a file, and it will appear here.';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = filtered
    .map(
      (a, i) => `
    <div class="artifact-card" data-artifact-index="${i}">
      <div class="artifact-card-name">${escapeHtml(a.path.split('/').pop() || a.path)}</div>
      <div class="artifact-card-desc">${escapeHtml(a.description)}</div>
      <div class="artifact-card-meta">
        <span class="artifact-agent-label">${escapeHtml(agentName(a.agentId))}</span>
        <span>${formatTime(a.timestamp)}</span>
      </div>
    </div>
  `,
    )
    .join('');

  grid.querySelectorAll<HTMLDivElement>('.artifact-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const idx = parseInt(card.dataset.artifactIndex!, 10);
      const artifact = filtered[idx];
      await showArtifactDetail(artifact);
    });
  });
}

async function showArtifactDetail(artifact: ArtifactMeta): Promise<void> {
  const modal = document.getElementById('artifact-detail-modal')!;
  const content = document.getElementById('artifact-detail-content')!;

  const filename = artifact.path.split('/').pop() || artifact.path;

  let fileContent = '(Unable to read file content)';
  try {
    const result = await sendMsg<{ content: string }>({
      type: 'readArtifactContent',
      path: artifact.path,
    });
    fileContent = result.content;
  } catch {
    // Leave default message
  }

  content.innerHTML = `
    <h2>${escapeHtml(filename)}</h2>
    <div class="task-detail-field">
      <div class="task-detail-label">Description</div>
      <div class="task-detail-value">${escapeHtml(artifact.description)}</div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Producer</div>
      <div class="task-detail-value">${escapeHtml(agentName(artifact.agentId))}</div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Path</div>
      <div class="task-detail-value" style="font-family:var(--font-mono);font-size:var(--text-xs);">${escapeHtml(artifact.path)}</div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Created</div>
      <div class="task-detail-value">${formatTimeFull(artifact.timestamp)}</div>
    </div>
    <div class="task-detail-field">
      <div class="task-detail-label">Content</div>
      <div class="modal-content-preview">${escapeHtml(fileContent)}</div>
    </div>
  `;

  modal.classList.add('visible');
}

document.getElementById('artifacts-filter-agent')!.addEventListener('change', renderArtifacts);

document.getElementById('artifact-detail-close')!.addEventListener('click', () => {
  document.getElementById('artifact-detail-modal')!.classList.remove('visible');
});

document.getElementById('artifact-detail-modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('artifact-detail-modal')) {
    document.getElementById('artifact-detail-modal')!.classList.remove('visible');
  }
});

// ══════════════════════════════════════════
// ── Files View (OPFS File Explorer)
// ══════════════════════════════════════════

interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

const filesTree = document.getElementById('files-tree') as HTMLDivElement;
const filesViewerFilename = document.getElementById('files-viewer-filename') as HTMLSpanElement;
const filesViewerContent = document.getElementById('files-viewer-content') as HTMLDivElement;
const filesBtnDownload = document.getElementById('files-btn-download') as HTMLButtonElement;

let filesSelectedPath: string | null = null;
let filesSelectedContent: string | null = null;

function loadFilesView(): void {
  if (!activeAgentId) return;

  filesTree.innerHTML = '<p style="color:var(--text-muted);padding:12px;">Loading...</p>';
  filesViewerFilename.textContent = 'No file selected';
  filesViewerContent.innerHTML = '<div class="files-viewer-empty">Select a file to view its contents.</div>';
  filesBtnDownload.style.display = 'none';

  sendMsg<{ files: FileEntry[] }>({ type: 'listAgentFiles', agentId: activeAgentId }).then((result) => {
    renderFileTree(result.files, activeAgentId!, 0);
  }).catch((err) => {
    filesTree.innerHTML = `<p style="color:var(--danger-text);padding:12px;">Error: ${err instanceof Error ? err.message : String(err)}</p>`;
  });
}

function renderFileTree(entries: FileEntry[], agentId: string, depth: number): void {
  if (depth === 0) {
    filesTree.innerHTML = '';
  }

  if (entries.length === 0 && depth === 0) {
    filesTree.innerHTML = '<div class="empty-state" style="padding:24px;"><p>No files found for this agent.</p></div>';
    return;
  }

  // Sort: directories first, then files, alphabetically
  const sorted = [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const item = document.createElement('div');
    item.className = `files-tree-item${entry.kind === 'directory' ? ' directory' : ''}`;
    if (depth === 1) item.classList.add('files-indent');
    else if (depth === 2) item.classList.add('files-indent-2');
    else if (depth >= 3) item.classList.add('files-indent-3');

    const icon = entry.kind === 'directory'
      ? '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const sizeStr = entry.size !== undefined ? formatFileSize(entry.size) : '';

    item.innerHTML = `<span class="icon">${icon}</span><span class="name">${escapeHtml(entry.name)}</span>${sizeStr ? `<span class="size">${sizeStr}</span>` : ''}`;

    if (entry.kind === 'file') {
      item.addEventListener('click', () => {
        filesTree.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
        item.classList.add('selected');
        loadFileContent(agentId, entry.path, entry.name);
      });
    }

    filesTree.appendChild(item);

    if (entry.kind === 'directory' && entry.children) {
      renderFileTree(entry.children, agentId, depth + 1);
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function loadFileContent(agentId: string, filePath: string, fileName: string): Promise<void> {
  filesViewerFilename.textContent = fileName;
  filesViewerContent.innerHTML = '<p style="color:var(--text-muted);">Loading...</p>';
  filesBtnDownload.style.display = 'none';

  try {
    const result = await sendMsg<{ content: string }>({ type: 'readAgentFile', agentId, path: filePath });
    filesSelectedPath = filePath;
    filesSelectedContent = result.content;
    filesBtnDownload.style.display = '';

    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (ext === 'md') {
      filesViewerContent.className = 'files-viewer-content markdown-view';
      const rawHtml = marked.parse(result.content) as string;
      filesViewerContent.innerHTML = DOMPurify.sanitize(rawHtml);
    } else if (ext === 'jsonl') {
      filesViewerContent.className = 'files-viewer-content';
      const lines = result.content.split('\n').filter((l) => l.trim());
      filesViewerContent.innerHTML = lines
        .map((line) => {
          try {
            const parsed = JSON.parse(line);
            return `<div class="files-jsonl-entry">${escapeHtml(JSON.stringify(parsed, null, 2))}</div>`;
          } catch {
            return `<div class="files-jsonl-entry">${escapeHtml(line)}</div>`;
          }
        })
        .join('');
    } else {
      filesViewerContent.className = 'files-viewer-content raw-view';
      filesViewerContent.textContent = result.content;
    }
  } catch (err) {
    filesViewerContent.className = 'files-viewer-content raw-view';
    filesViewerContent.textContent = `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

filesBtnDownload.addEventListener('click', () => {
  if (!filesSelectedContent || !filesSelectedPath) return;
  const fileName = filesSelectedPath.split('/').pop() || 'file';
  const blob = new Blob([filesSelectedContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════
// ── Agent Settings View (per-agent)
// ══════════════════════════════════════════

async function loadAgentSettings(): Promise<void> {
  const container = document.getElementById('agent-settings-content')!;
  if (!activeAgentId) {
    container.innerHTML = '<div class="empty-state"><p>Select an agent to view its settings.</p></div>';
    return;
  }

  container.innerHTML = '<div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    const result = await sendMsg<{
      claudeMd: string;
      journal: string[];
      bookmarks: string[];
      meta: AgentMeta;
    }>({ type: 'getAgentDetail', agentId: activeAgentId });

    const meta = result.meta;
    const claudeMd = result.claudeMd || '';

    container.innerHTML = `
      <div class="section-header">
        <h2>${escapeHtml(meta.name)} Settings</h2>
      </div>

      <div class="agent-meta-row">
        <span class="meta-label">Role</span>
        <span class="badge ${roleBadgeClass(meta.role)}">${escapeHtml(meta.role)}</span>
        <span class="meta-label" style="margin-left:var(--sp-4);">Visibility</span>
        <span class="badge ${visBadgeClass(meta.visibility)}">${escapeHtml(meta.visibility)}</span>
        <span class="meta-label" style="margin-left:var(--sp-4);">Created</span>
        <span>${formatTimeFull(meta.createdAt)}</span>
      </div>

      <div class="agent-settings-section">
        <h3>Visibility</h3>
        <div class="agent-settings-field">
          <label for="agent-vis-select">Who can see this agent?</label>
          <select id="agent-vis-select">
            <option value="private"${meta.visibility === 'private' ? ' selected' : ''}>Private (hidden from other agents)</option>
            <option value="visible"${meta.visibility === 'visible' ? ' selected' : ''}>Visible (can send/receive messages)</option>
            <option value="open"${meta.visibility === 'open' ? ' selected' : ''}>Open (visible + shared artifacts)</option>
          </select>
        </div>
      </div>

      <details class="agent-settings-section">
        <summary style="cursor:pointer;user-select:none;"><h3 style="display:inline;">Tools</h3></summary>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--sp-3) 0;">
          Configure which tools this agent can use. read_file and list_directory are always enabled.
        </p>
        <div id="agent-tools-config"></div>
        <div style="margin-top:var(--sp-3);">
          <button class="btn btn-primary btn-sm" id="btn-save-tools">Save Tool Configuration</button>
        </div>
      </details>

      <div class="agent-settings-section">
        <h3>Skills</h3>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-3);">
          Skills add specialised knowledge and instructions to this agent's system prompt.
        </p>
        <div id="agent-skills-list"></div>

        <div style="margin-top:var(--sp-4);border-top:1px solid var(--border-default);padding-top:var(--sp-4);">
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3);cursor:pointer;" id="btn-toggle-skill-browser">
            <h4 style="margin:0;">Browse Skills</h4>
            <span id="skill-browser-chevron" style="font-size:var(--text-xs);color:var(--text-muted);">&#9654;</span>
          </div>
          <div id="skill-browser-section" style="display:none;">
            <div id="featured-skills-list"></div>
          </div>
        </div>

        <div class="skills-add-section" style="margin-top:var(--sp-4);">
          <h4>Add Skill</h4>
          <div class="agent-settings-field">
            <label for="skill-url-input">Import from URL</label>
            <div style="display:flex;gap:var(--sp-2);align-items:center;">
              <input type="text" id="skill-url-input" placeholder="https://github.com/user/repo or direct SKILL.md URL" style="flex:1;">
              <button class="btn btn-primary btn-sm" id="btn-import-skill-url">Import</button>
            </div>
            <div id="skill-import-status" style="display:none;margin-top:var(--sp-2);"></div>
          </div>
          <div id="skill-preview-section" style="display:none;margin-top:var(--sp-3);background:var(--bg-base);border:1px solid var(--border-default);border-radius:8px;padding:var(--sp-3);">
            <h5 style="margin:0 0 var(--sp-2) 0;">Skill Preview</h5>
            <div id="skill-preview-meta" style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-2);"></div>
            <pre id="skill-preview-content" style="font-size:var(--text-xs);max-height:200px;overflow-y:auto;background:var(--bg-surface);padding:var(--sp-2);border-radius:4px;white-space:pre-wrap;word-break:break-word;"></pre>
            <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
              <button class="btn btn-primary btn-sm" id="btn-confirm-skill-install">Install</button>
              <button class="btn btn-sm" id="btn-cancel-skill-preview">Cancel</button>
            </div>
          </div>
          <div class="agent-settings-field">
            <label for="skill-name-input">Skill Name</label>
            <input type="text" id="skill-name-input" placeholder="e.g. Frontend Design">
          </div>
          <div class="agent-settings-field">
            <label for="skill-desc-input">Description</label>
            <input type="text" id="skill-desc-input" placeholder="Brief description of the skill">
          </div>
          <div class="agent-settings-field">
            <label for="skill-content-input">SKILL.md Content</label>
            <textarea id="skill-content-input" class="claude-md-editor" style="min-height:120px;" placeholder="Paste SKILL.md content here..."></textarea>
          </div>
          <div style="margin-top:var(--sp-2);">
            <button class="btn btn-primary btn-sm" id="btn-install-skill">Install Skill</button>
          </div>
        </div>
      </div>

      <div class="agent-settings-section">
        <h3>CLAUDE.md</h3>
        <textarea class="claude-md-editor" id="agent-claude-md">${escapeHtml(claudeMd)}</textarea>
        <div style="margin-top:var(--sp-3);">
          <button class="btn btn-primary btn-sm" id="btn-save-claude-md">Save CLAUDE.md</button>
        </div>
      </div>

      <div class="agent-settings-section">
        <div style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer;margin-bottom:var(--sp-3);" id="btn-toggle-archived-agents">
          <h3 style="margin:0;">Archived Agents</h3>
          <span id="archived-agents-chevron" style="font-size:var(--text-xs);color:var(--text-muted);">&#9654;</span>
        </div>
        <div id="archived-agents-section" style="display:none;">
          <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-3);">
            Agents that were archived (removed but with data preserved). You can restore them or permanently delete their data.
          </p>
          <div id="archived-agents-list"></div>
        </div>
      </div>

      <div class="agent-settings-section">
        <h3>Danger Zone</h3>
        <div class="danger-zone">
          <p>Permanently delete this agent and all its data.</p>
          <button class="btn btn-danger btn-sm" id="btn-delete-agent-settings">Delete Agent</button>
        </div>
      </div>
    `;

    // Visibility change
    document.getElementById('agent-vis-select')!.addEventListener('change', async (e) => {
      const newVis = (e.target as HTMLSelectElement).value;
      await sendMsg({ type: 'updateAgentVisibility', agentId: meta.id, visibility: newVis });
      sendPortMessage({ type: 'listAgents' });
    });

    // Render tools configuration
    const MINIMUM_TOOLS = ['read_file', 'list_directory'];
    const allRegisteredTools = toolRegistry.getAll();
    const toolsByCategory = new Map<string, ToolMeta[]>();
    for (const t of allRegisteredTools) {
      const cat = t.category;
      if (!toolsByCategory.has(cat)) toolsByCategory.set(cat, []);
      toolsByCategory.get(cat)!.push(t);
    }

    // Determine which tools are currently disabled
    const disabledSet = new Set<string>(meta.disabledTools ?? []);

    const toolsContainer = document.getElementById('agent-tools-config')!;
    const categoryOrder = ['file', 'chrome', 'web', 'communication', 'wasm'];
    const categoryLabels: Record<string, string> = {
      file: 'File',
      chrome: 'Chrome',
      web: 'Web',
      communication: 'Communication',
      wasm: 'WASM',
    };

    let toolsHtml = '';
    for (const cat of categoryOrder) {
      const tools = toolsByCategory.get(cat);
      if (!tools || tools.length === 0) continue;
      const enabledCount = tools.filter(t => MINIMUM_TOOLS.includes(t.name) || !disabledSet.has(t.name)).length;
      toolsHtml += `<details class="tools-category" style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden;margin-bottom:var(--sp-2);">`;
      toolsHtml += `<summary style="padding:8px 12px;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--text-primary);background:var(--bg-raised);user-select:none;">${categoryLabels[cat] || cat} <span style="font-size:var(--text-xs);color:var(--text-muted);">(${enabledCount}/${tools.length})</span></summary>`;
      toolsHtml += `<div class="tools-grid" style="padding:8px;">`;
      for (const t of tools) {
        const isMinimum = MINIMUM_TOOLS.includes(t.name);
        const isChecked = isMinimum || !disabledSet.has(t.name);
        toolsHtml += `<label class="tool-toggle">`;
        toolsHtml += `<input type="checkbox" data-tool-name="${escapeHtml(t.name)}" ${isChecked ? 'checked' : ''} ${isMinimum ? 'disabled' : ''}>`;
        toolsHtml += `<span class="tool-toggle-name">${escapeHtml(t.name)}</span>`;
        toolsHtml += `<span class="tool-toggle-desc">${escapeHtml(t.description)}</span>`;
        if (isMinimum) {
          toolsHtml += `<span class="tool-toggle-required">(required)</span>`;
        }
        toolsHtml += `</label>`;
      }
      toolsHtml += `</div></details>`;
    }
    toolsContainer.innerHTML = toolsHtml;

    // Save tools configuration
    document.getElementById('btn-save-tools')!.addEventListener('click', async () => {
      const checkboxes = toolsContainer.querySelectorAll<HTMLInputElement>('input[data-tool-name]');
      const disabled: string[] = [];
      checkboxes.forEach((cb) => {
        if (!cb.checked && !MINIMUM_TOOLS.includes(cb.dataset.toolName!)) {
          disabled.push(cb.dataset.toolName!);
        }
      });
      await sendMsg({
        type: 'updateAgentTools',
        agentId: meta.id,
        disabledTools: disabled.length > 0 ? disabled : undefined,
        enabledTools: undefined,
      });
      { const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Tool configuration saved.'); }
    });

    // Skills section
    await loadSkillsList(meta.id);

    // Install skill from paste
    document.getElementById('btn-install-skill')!.addEventListener('click', async () => {
      const name = (document.getElementById('skill-name-input') as HTMLInputElement).value.trim();
      const description = (document.getElementById('skill-desc-input') as HTMLInputElement).value.trim();
      const content = (document.getElementById('skill-content-input') as HTMLTextAreaElement).value.trim();
      if (!content) {
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Please paste SKILL.md content.');
        return;
      }
      if (!name && !content.startsWith('---')) {
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Please provide a skill name or include frontmatter.');
        return;
      }
      try {
        await sendMsg({ type: 'installSkill', agentId: meta.id, name: name || 'Unnamed Skill', description: description || 'No description', content });
        (document.getElementById('skill-name-input') as HTMLInputElement).value = '';
        (document.getElementById('skill-desc-input') as HTMLInputElement).value = '';
        (document.getElementById('skill-content-input') as HTMLTextAreaElement).value = '';
        await loadSkillsList(meta.id);
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Skill installed.');
      } catch (err) {
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed to install skill: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Import skill from URL (with preview)
    let pendingSkillUrl = '';

    document.getElementById('btn-import-skill-url')!.addEventListener('click', async () => {
      const url = (document.getElementById('skill-url-input') as HTMLInputElement).value.trim();
      if (!url) {
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Please enter a URL.');
        return;
      }
      const statusEl = document.getElementById('skill-import-status')!;
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="color:var(--text-muted);font-size:var(--text-xs);">Fetching skill...</span>';
      try {
        const result = await sendMsg<{
          meta: { name: string; description: string; author?: string; version?: string };
          preview: string;
          fileCount: number;
          files: string[];
        }>({ type: 'fetchSkillPreviewOneShot', url });
        if ('error' in result) throw new Error((result as unknown as { error: string }).error);
        pendingSkillUrl = url;
        statusEl.style.display = 'none';
        // Show preview
        const previewSection = document.getElementById('skill-preview-section')!;
        const metaEl = document.getElementById('skill-preview-meta')!;
        const contentEl = document.getElementById('skill-preview-content')!;
        metaEl.innerHTML = `<strong>${escapeHtml(result.meta.name)}</strong>` +
          (result.meta.author ? ` by ${escapeHtml(result.meta.author)}` : '') +
          (result.meta.version ? ` (v${escapeHtml(result.meta.version)})` : '') +
          `<br>${escapeHtml(result.meta.description)}` +
          `<br>${result.fileCount} file(s): ${result.files.map(escapeHtml).join(', ')}`;
        contentEl.textContent = result.preview;
        previewSection.style.display = 'block';
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--text-danger);font-size:var(--text-xs);">Failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`;
      }
    });

    document.getElementById('btn-confirm-skill-install')!.addEventListener('click', async () => {
      if (!pendingSkillUrl) return;
      const statusEl = document.getElementById('skill-import-status')!;
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="color:var(--text-muted);font-size:var(--text-xs);">Installing...</span>';
      try {
        await sendMsg({ type: 'importSkillFromUrlOneShot', agentId: meta.id, url: pendingSkillUrl });
        document.getElementById('skill-preview-section')!.style.display = 'none';
        (document.getElementById('skill-url-input') as HTMLInputElement).value = '';
        statusEl.style.display = 'none';
        pendingSkillUrl = '';
        await loadSkillsList(meta.id);
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Skill installed from URL.');
      } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--text-danger);font-size:var(--text-xs);">Install failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`;
      }
    });

    document.getElementById('btn-cancel-skill-preview')!.addEventListener('click', () => {
      document.getElementById('skill-preview-section')!.style.display = 'none';
      pendingSkillUrl = '';
    });

    // Skills browser toggle
    document.getElementById('btn-toggle-skill-browser')!.addEventListener('click', () => {
      const section = document.getElementById('skill-browser-section')!;
      const chevron = document.getElementById('skill-browser-chevron')!;
      const visible = section.style.display !== 'none';
      section.style.display = visible ? 'none' : 'block';
      chevron.innerHTML = visible ? '&#9654;' : '&#9660;';
      if (!visible) renderFeaturedSkills(meta.id);
    });

    // Archived agents toggle
    document.getElementById('btn-toggle-archived-agents')!.addEventListener('click', () => {
      const section = document.getElementById('archived-agents-section')!;
      const chevron = document.getElementById('archived-agents-chevron')!;
      const visible = section.style.display !== 'none';
      section.style.display = visible ? 'none' : 'block';
      chevron.innerHTML = visible ? '&#9654;' : '&#9660;';
      if (!visible) loadArchivedAgents();
    });

    // Save CLAUDE.md
    document.getElementById('btn-save-claude-md')!.addEventListener('click', async () => {
      const content = (document.getElementById('agent-claude-md') as HTMLTextAreaElement).value;
      await sendMsg({ type: 'setClaudeMd', agentId: meta.id, content });
      { const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'CLAUDE.md saved.'); }
    });

    // Delete agent
    document.getElementById('btn-delete-agent-settings')!.addEventListener('click', () => {
      showConfirm(
        'Delete Agent',
        `Are you sure you want to delete "${meta.name}"? This cannot be undone.`,
        async () => {
          await sendMsg({ type: 'deleteAgent', agentId: meta.id });
          activeAgentId = null;
          activeView = 'chat';
          sidebarItems.forEach((b) => {
            b.classList.toggle('active', b.dataset.view === 'chat');
          });
          sendPortMessage({ type: 'listAgents' });
        },
      );
    });
  } catch (err) {
    container.innerHTML = `<div class="panel-error" style="display:block;">Failed to load agent settings: ${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

// ── Skills helpers ──

interface SkillMetaUI {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  source?: string;
  installedAt: string;
  files: string[];
}

async function loadSkillsList(agentId: string): Promise<void> {
  const container = document.getElementById('agent-skills-list');
  if (!container) return;

  try {
    const result = await sendMsg<{ skills: SkillMetaUI[] }>({ type: 'listSkills', agentId });
    const skills = result.skills || [];

    if (skills.length === 0) {
      container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">No skills installed.</p>';
      return;
    }

    let html = '<div class="skills-list">';
    for (const skill of skills) {
      const installed = new Date(skill.installedAt).toLocaleDateString();
      html += `<div class="skill-card" data-skill-id="${escapeHtml(skill.id)}">`;
      html += `<div class="skill-card-header">`;
      html += `<span class="skill-card-name">${escapeHtml(skill.name)}</span>`;
      if (skill.version) html += `<span class="badge badge-neutral" style="margin-left:var(--sp-2);">v${escapeHtml(skill.version)}</span>`;
      html += `<button class="btn btn-danger btn-xs skill-remove-btn" data-skill-id="${escapeHtml(skill.id)}" title="Remove skill" style="margin-left:auto;">Remove</button>`;
      html += `</div>`;
      html += `<p class="skill-card-desc">${escapeHtml(skill.description)}</p>`;
      html += `<div class="skill-card-meta">`;
      if (skill.author) html += `<span>Author: ${escapeHtml(skill.author)}</span>`;
      if (skill.source) html += `<span>Source: ${escapeHtml(skill.source)}</span>`;
      html += `<span>Installed: ${installed}</span>`;
      html += `<span>Files: ${skill.files.length}</span>`;
      html += `</div>`;
      html += `</div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    // Attach remove handlers
    container.querySelectorAll<HTMLButtonElement>('.skill-remove-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const skillId = btn.dataset.skillId!;
        try {
          await sendMsg({ type: 'removeSkill', agentId, skillId });
          await loadSkillsList(agentId);
          const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Skill "${skillId}" removed.`);
        } catch (err) {
          const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed to remove skill: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    });
  } catch {
    container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">Failed to load skills.</p>';
  }
}

async function fetchSkillContent(url: string): Promise<string> {
  // Try GitHub first
  const repoMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/,
  );
  if (repoMatch) {
    const [, owner, repo, branch = 'main', subpath = ''] = repoMatch;
    const basePath = subpath ? `${subpath}/` : '';
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${basePath}SKILL.md`;
    const response = await fetch(rawUrl);
    if (response.ok) return response.text();
  }

  // Try direct URL
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  return response.text();
}

// ── Featured Skills ──

const FEATURED_SKILLS = [
  {
    name: 'Frontend Design (Impeccable)',
    author: 'pbakaus',
    url: 'https://github.com/pbakaus/impeccable',
    description: 'Design vocabulary and audit commands for frontend work',
  },
  {
    name: 'Claude Code Best Practices',
    author: 'anthropics',
    url: 'https://github.com/anthropics/claude-code-best-practices',
    description: 'Best practices for working with Claude Code',
  },
  {
    name: 'Cursor Rules Collection',
    author: 'PatrickJS',
    url: 'https://github.com/PatrickJS/awesome-cursorrules',
    description: 'Curated list of cursor rules and AI coding skills',
  },
  {
    name: 'AI Prompts Collection',
    author: 'f',
    url: 'https://github.com/f/awesome-chatgpt-prompts',
    description: 'Collection of useful prompt patterns and techniques',
  },
];

function renderFeaturedSkills(agentId: string): void {
  const container = document.getElementById('featured-skills-list');
  if (!container) return;

  let html = '<div class="skills-list">';
  for (const skill of FEATURED_SKILLS) {
    html += `<div class="skill-card">`;
    html += `<div class="skill-card-header">`;
    html += `<span class="skill-card-name">${escapeHtml(skill.name)}</span>`;
    html += `<button class="btn btn-primary btn-xs featured-skill-install" data-url="${escapeHtml(skill.url)}" style="margin-left:auto;">Install</button>`;
    html += `</div>`;
    html += `<p class="skill-card-desc">${escapeHtml(skill.description)}</p>`;
    html += `<div class="skill-card-meta">`;
    html += `<span>Author: ${escapeHtml(skill.author)}</span>`;
    html += `<span><a href="${escapeHtml(skill.url)}" target="_blank" style="color:var(--text-link);">GitHub</a></span>`;
    html += `</div>`;
    html += `</div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  // Attach install handlers
  container.querySelectorAll<HTMLButtonElement>('.featured-skill-install').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url!;
      btn.textContent = 'Installing...';
      btn.disabled = true;
      try {
        await sendMsg({ type: 'importSkillFromUrlOneShot', agentId, url });
        btn.textContent = 'Installed';
        await loadSkillsList(agentId);
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Skill installed from ${url}`);
      } catch (err) {
        btn.textContent = 'Failed';
        btn.disabled = false;
        const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });
}

// ── Archived Agents ──

async function loadArchivedAgents(): Promise<void> {
  const container = document.getElementById('archived-agents-list');
  if (!container) return;

  try {
    const result = await sendMsg<{ agents: Array<{ id: string; name: string; role: string; archivedAt?: string }> }>({ type: 'listArchivedAgents' });
    const agents = result.agents || [];

    if (agents.length === 0) {
      container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">No archived agents.</p>';
      return;
    }

    let html = '<div class="skills-list">';
    for (const agent of agents) {
      const archived = agent.archivedAt ? new Date(agent.archivedAt).toLocaleDateString() : 'Unknown';
      html += `<div class="skill-card" data-agent-id="${escapeHtml(agent.id)}">`;
      html += `<div class="skill-card-header">`;
      html += `<span class="skill-card-name">${escapeHtml(agent.name)}</span>`;
      html += `<span class="badge badge-neutral" style="margin-left:var(--sp-2);">${escapeHtml(agent.role)}</span>`;
      html += `<div style="margin-left:auto;display:flex;gap:var(--sp-1);">`;
      html += `<button class="btn btn-primary btn-xs archived-agent-restore" data-agent-id="${escapeHtml(agent.id)}">Restore</button>`;
      html += `<button class="btn btn-danger btn-xs archived-agent-delete" data-agent-id="${escapeHtml(agent.id)}">Delete</button>`;
      html += `</div>`;
      html += `</div>`;
      html += `<div class="skill-card-meta">`;
      html += `<span>Archived: ${archived}</span>`;
      html += `</div>`;
      html += `</div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    // Restore handlers
    container.querySelectorAll<HTMLButtonElement>('.archived-agent-restore').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const agentId = btn.dataset.agentId!;
        try {
          await sendMsg({ type: 'restoreAgent', agentId });
          await loadArchivedAgents();
          sendPortMessage({ type: 'listAgents' });
          const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Agent restored.');
        } catch (err) {
          const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed to restore: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    });

    // Delete permanently handlers
    container.querySelectorAll<HTMLButtonElement>('.archived-agent-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const agentId = btn.dataset.agentId!;
        showConfirm(
          'Delete Permanently',
          'This will permanently delete all data for this archived agent. This cannot be undone.',
          async () => {
            try {
              await sendMsg({ type: 'deleteArchivedAgent', agentId });
              await loadArchivedAgents();
              const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, 'Archived agent permanently deleted.');
            } catch (err) {
              const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        );
      });
    });
  } catch {
    container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">Failed to load archived agents.</p>';
  }
}

// ══════════════════════════════════════════
// ── Global Settings View
// ══════════════════════════════════════════

const PROVIDERS = ['anthropic', 'google', 'openai', 'openrouter'] as const;

async function loadSettings(): Promise<void> {
  try {
    const result = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
    const keys = result.keys;

    (document.getElementById('settings-key-anthropic') as HTMLInputElement).value = keys.anthropic || '';
    (document.getElementById('settings-key-google') as HTMLInputElement).value = keys.google || '';
    (document.getElementById('settings-key-openai') as HTMLInputElement).value = keys.openai || '';
    (document.getElementById('settings-key-openrouter') as HTMLInputElement).value = keys.openrouter || '';

    // Load settings (provider, theme, model)
    const settingsResult = await sendMsg<{ settings: { activeProvider: string; theme: string; model?: string } }>({ type: 'getSettings' });
    const settings = settingsResult.settings;
    const activeProvider = settings.activeProvider || 'anthropic';

    // Select the active provider radio
    const radio = document.querySelector(`input[name="active-provider"][value="${activeProvider}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;

    // Theme
    (document.getElementById('theme-select') as HTMLSelectElement).value = settings.theme || 'system';

    // Populate model selectors for all providers
    for (const p of PROVIDERS) {
      populateProviderModels(p);
    }

    // Restore selected model on the active provider
    if (settings.model) {
      const select = document.getElementById(`model-select-${activeProvider}`) as HTMLSelectElement | null;
      const custom = document.getElementById(`custom-model-${activeProvider}`) as HTMLInputElement | null;
      if (select && custom) {
        const models = getFallbackModels(activeProvider);
        const inList = models.some((m) => m.value === settings.model);
        if (inList) {
          select.value = settings.model;
          custom.value = '';
        } else {
          select.value = '';
          custom.value = settings.model;
        }
      }
    }

    // Show model area for active provider
    updateProviderModelVisibility();
  } catch (err) {
    showPanelError('view-global-settings', `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function populateProviderModels(providerId: string): void {
  const select = document.getElementById(`model-select-${providerId}`) as HTMLSelectElement | null;
  if (!select) return;
  const models = getFallbackModels(providerId);
  select.innerHTML = '<option value="">(provider default)</option>';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  }
}

function updateProviderModelVisibility(): void {
  for (const p of PROVIDERS) {
    const area = document.getElementById(`model-area-${p}`);
    if (area) {
      const radio = document.querySelector(`input[name="active-provider"][value="${p}"]`) as HTMLInputElement;
      area.style.display = radio?.checked ? 'flex' : 'none';
    }
  }
}

// Radio change → show/hide model areas
for (const radio of document.querySelectorAll('input[name="active-provider"]')) {
  radio.addEventListener('change', () => updateProviderModelVisibility());
}

// Save provider settings (keys + active provider + model) in one click
document.getElementById('btn-save-provider-settings')!.addEventListener('click', async () => {
  const keys: ApiKeys = {
    anthropic: (document.getElementById('settings-key-anthropic') as HTMLInputElement).value.trim() || undefined,
    google: (document.getElementById('settings-key-google') as HTMLInputElement).value.trim() || undefined,
    openai: (document.getElementById('settings-key-openai') as HTMLInputElement).value.trim() || undefined,
    openrouter: (document.getElementById('settings-key-openrouter') as HTMLInputElement).value.trim() || undefined,
  };
  await sendMsg({ type: 'setApiKeys', keys });

  const activeRadio = document.querySelector('input[name="active-provider"]:checked') as HTMLInputElement;
  const provider = activeRadio?.value || 'anthropic';
  const customModel = (document.getElementById(`custom-model-${provider}`) as HTMLInputElement)?.value.trim();
  const selectModel = (document.getElementById(`model-select-${provider}`) as HTMLSelectElement)?.value;
  const model = customModel || selectModel || undefined;

  const settingsResult = await sendMsg<{ settings: { theme: string } }>({ type: 'getSettings' });
  const currentTheme = settingsResult.settings?.theme || 'system';
  await sendMsg({ type: 'setSettings', settings: { activeProvider: provider, theme: currentTheme, model } });
  alert('Settings saved.');
});

// Save theme separately
document.getElementById('btn-save-theme')!.addEventListener('click', async () => {
  const theme = (document.getElementById('theme-select') as HTMLSelectElement).value as 'system' | 'light' | 'dark';
  const settingsResult = await sendMsg<{ settings: { activeProvider: string; model?: string } }>({ type: 'getSettings' });
  const current = settingsResult.settings;
  await sendMsg({ type: 'setSettings', settings: { activeProvider: current?.activeProvider || 'anthropic', theme, model: current?.model } });
  applyTheme(theme);
  alert('Theme saved.');
});


/** Helper to get current API keys from storage. */
async function getCurrentApiKeys(): Promise<ApiKeys> {
  const result = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
  return result.keys;
}

// ── Mic Test ──

const btnTestMic = document.getElementById('btn-test-mic');
const micTestResult = document.getElementById('mic-test-result');

if (btnTestMic && micTestResult) {
  let testIframe: HTMLIFrameElement | null = null;

  btnTestMic.addEventListener('click', () => {
    if (testIframe) {
      // Stop test
      testIframe.contentWindow?.postMessage({ target: 'chaos-recognition', type: 'stop' }, '*');
      testIframe.remove();
      testIframe = null;
      btnTestMic.textContent = 'Test Microphone';
      return;
    }

    micTestResult.textContent = 'Starting...';
    micTestResult.style.color = 'var(--text-secondary)';

    testIframe = document.createElement('iframe');
    testIframe.src = chrome.runtime.getURL('src/voice/recognition-frame.html');
    testIframe.allow = 'microphone';
    testIframe.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;border:none;opacity:0;';
    document.body.appendChild(testIframe);

    btnTestMic.textContent = 'Stop Test';

    const handler = (event: MessageEvent) => {
      if (event.data?.source !== 'chaos-recognition') return;
      switch (event.data.type) {
        case 'recognition-started':
          micTestResult.textContent = 'Mic working. Speak now...';
          micTestResult.style.color = 'var(--success-text)';
          break;
        case 'recognition-result':
          if (event.data.finalTranscript || event.data.interimTranscript) {
            micTestResult.textContent = 'Heard: "' + (event.data.finalTranscript || event.data.interimTranscript).trim().slice(0, 60) + '"';
            micTestResult.style.color = 'var(--success-text)';
          }
          break;
        case 'recognition-error':
          micTestResult.textContent = 'Error: ' + event.data.error;
          micTestResult.style.color = 'var(--danger)';
          break;
        case 'recognition-ended':
          window.removeEventListener('message', handler);
          if (testIframe) {
            testIframe.remove();
            testIframe = null;
          }
          btnTestMic.textContent = 'Test Microphone';
          break;
      }
    };
    window.addEventListener('message', handler);

    // Auto-stop after 10 seconds
    setTimeout(() => {
      if (testIframe) {
        testIframe.contentWindow?.postMessage({ target: 'chaos-recognition', type: 'stop' }, '*');
      }
    }, 10000);
  });
}

// ── Browser Permissions ──

async function loadBrowserPermissions(): Promise<void> {
  const container = document.getElementById('browser-permissions-area');
  if (!container) return;

  const browserPerms = [
    { id: 'page-content', label: 'Read page content', permission: 'scripting' as const, needsHost: true },
    { id: 'tabs', label: 'Tab management', permission: 'tabs' as const, needsHost: false },
    { id: 'bookmarks', label: 'Bookmarks', permission: 'bookmarks' as const, needsHost: false },
    { id: 'history', label: 'Browsing history', permission: 'history' as const, needsHost: false },
  ];

  const rows: string[] = [];
  for (const perm of browserPerms) {
    const granted = await hasPermission(perm.permission) && (!perm.needsHost || await hasHostPermissions());
    rows.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;font-size:var(--text-sm);border-bottom:1px solid var(--border-subtle);">
      <span style="color:var(--text-secondary);">${perm.label}</span>
      <button class="browser-perm-btn btn" data-perm="${perm.permission}" data-needs-host="${perm.needsHost}"
        style="padding:4px 12px;border-radius:4px;font-size:var(--text-xs);cursor:pointer;border:1px solid ${granted ? 'var(--success)' : 'var(--accent)'};background:${granted ? 'var(--success-subtle)' : 'var(--accent-subtle)'};color:${granted ? 'var(--success)' : 'var(--accent-text)'};">
        ${granted ? 'Enabled' : 'Enable'}
      </button>
    </div>`);
  }
  container.innerHTML = rows.join('');

  container.querySelectorAll<HTMLButtonElement>('.browser-perm-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const permName = btn.dataset.perm! as chrome.runtime.ManifestPermissions;
      const needsHost = btn.dataset.needsHost === 'true';
      const label = btn.parentElement?.querySelector('span')?.textContent || permName;
      const request: chrome.permissions.Permissions = { permissions: [permName] };
      if (needsHost) request.origins = ['<all_urls>'];
      try {
        const granted = await chrome.permissions.request(request);
        if (granted) {
          btn.textContent = 'Enabled';
          btn.style.borderColor = 'var(--success)';
          btn.style.background = 'var(--success-subtle)';
          btn.style.color = 'var(--success)';
        } else {
          btn.textContent = 'Denied';
          btn.style.borderColor = 'var(--danger)';
          btn.style.background = 'var(--danger-subtle)';
          btn.style.color = 'var(--danger-text)';
          const errMsg = document.createElement('div');
          errMsg.textContent = `"${label}" permission was denied. Your browser or IT policy may be blocking this.`;
          errMsg.style.cssText = 'font-size:var(--text-xs);color:var(--danger-text);margin-top:4px;padding:4px 8px;background:var(--danger-subtle);border-radius:4px;';
          btn.parentElement?.appendChild(errMsg);
          setTimeout(() => {
            errMsg.remove();
            btn.textContent = 'Enable';
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'var(--accent-subtle)';
            btn.style.color = 'var(--accent-text)';
          }, 5000);
        }
      } catch (err) {
        btn.textContent = 'Error';
        btn.style.borderColor = 'var(--danger)';
        btn.style.background = 'var(--danger-subtle)';
        btn.style.color = 'var(--danger-text)';
        const errMsg = document.createElement('div');
        errMsg.textContent = `Failed to request "${label}": ${err instanceof Error ? err.message : String(err)}`;
        errMsg.style.cssText = 'font-size:var(--text-xs);color:var(--danger-text);margin-top:4px;padding:4px 8px;background:var(--danger-subtle);border-radius:4px;';
        btn.parentElement?.appendChild(errMsg);
        setTimeout(() => {
          errMsg.remove();
          btn.textContent = 'Enable';
          btn.style.borderColor = 'var(--accent)';
          btn.style.background = 'var(--accent-subtle)';
          btn.style.color = 'var(--accent-text)';
        }, 5000);
      }
    });
  });
}

// ── Tool Permissions ──

async function loadPermissions(): Promise<void> {
  const perms = await getAllPermissions();
  const grid = document.getElementById('tool-permissions-grid')!;

  const toolNames = Object.keys(DEFAULT_PERMISSIONS).sort();

  // Group tools by category (prefix before first underscore)
  const groups: Record<string, string[]> = {};
  for (const name of toolNames) {
    const cat = name.split('_')[0] || 'other';
    (groups[cat] ??= []).push(name);
  }

  const categoryLabels: Record<string, string> = {
    read: 'File (Read)', write: 'File (Write)', edit: 'File (Edit)',
    append: 'File (Append)', mkdir: 'File (Mkdir)', list: 'File (List)',
    tab: 'Tabs', bookmark: 'Bookmarks', history: 'History',
    alarm: 'Alarms', message: 'Messages', task: 'Tasks',
    artifact: 'Artifacts', agent: 'Agents', fetch: 'Web',
  };

  grid.innerHTML = Object.entries(groups).map(([cat, names]) => {
    const label = categoryLabels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
    const rows = names.map((name) => {
      const level = perms[name] ?? 'ask';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-base);border-radius:4px;border:1px solid var(--border-subtle);">
          <span style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--text-secondary);">${escapeHtml(name)}</span>
          <select class="perm-select" data-tool="${escapeHtml(name)}" style="background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:4px;padding:2px 6px;font-size:var(--text-xs);outline:none;">
            <option value="always"${level === 'always' ? ' selected' : ''}>Always</option>
            <option value="ask"${level === 'ask' ? ' selected' : ''}>Ask</option>
            <option value="never"${level === 'never' ? ' selected' : ''}>Never</option>
          </select>
        </div>`;
    }).join('');
    return `
      <details style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden;">
        <summary style="padding:8px 12px;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--text-primary);background:var(--bg-raised);user-select:none;">${escapeHtml(label)} <span style="font-size:var(--text-xs);color:var(--text-muted);">(${names.length})</span></summary>
        <div style="display:grid;gap:4px;padding:8px;">${rows}</div>
      </details>`;
  }).join('');
}

document.getElementById('btn-save-permissions')!.addEventListener('click', async () => {
  const selects = document.querySelectorAll<HTMLSelectElement>('.perm-select');
  for (const sel of selects) {
    const toolName = sel.dataset.tool!;
    const level = sel.value as PermissionLevel;
    await setPermission(toolName, level);
  }
  alert('Tool permissions saved.');
});

// ══════════════════════════════════════════
// ── Channels UI (in Global Settings)
// ══════════════════════════════════════════

import { getRelaySettings, setRelaySettings, clearRelaySettings, DEFAULT_RELAY_URL, type RelaySettings } from './channels/config.js';
import {
  registerWithRelay,
  registerChannel as relayRegisterChannel,
  registerTelegramChannel,
  listChannels as relayListChannels,
  updateChannel as relayUpdateChannel,
  removeChannel as relayRemoveChannel,
  type RelayConfig,
} from './channels/relay-client.js';

const MAX_CHANNEL_LOG_LINES = 200;

function channelLog(message: string): void {
  const el = document.getElementById('channel-log-output');
  if (!el) return;
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const line = `[${timestamp}] ${message}\n`;
  el.textContent = (el.textContent || '') + line;
  // Trim to max lines
  const lines = el.textContent!.split('\n');
  if (lines.length > MAX_CHANNEL_LOG_LINES + 1) {
    el.textContent = lines.slice(lines.length - MAX_CHANNEL_LOG_LINES - 1).join('\n');
  }
  el.scrollTop = el.scrollHeight;
}

document.getElementById('btn-clear-channel-log')!.addEventListener('click', () => {
  const el = document.getElementById('channel-log-output');
  if (el) el.textContent = '';
});

// Listen for log messages broadcast from the background poller
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'channelLog' && typeof message.message === 'string') {
    channelLog(message.message);
  }
});

function updateRelayUrlLabel(): void {
  const urlInput = document.getElementById('relay-server-url') as HTMLInputElement;
  const defaultLabel = document.getElementById('relay-url-default-label')!;
  const resetBtn = document.getElementById('btn-relay-url-reset')!;
  const currentValue = urlInput.value.trim().replace(/\/$/, '');
  const defaultValue = DEFAULT_RELAY_URL.replace(/\/$/, '');

  if (currentValue === defaultValue || currentValue === '') {
    defaultLabel.textContent = '(default)';
    resetBtn.style.display = 'none';
  } else {
    defaultLabel.textContent = '';
    resetBtn.style.display = '';
  }
}

async function renderChannelsUI(): Promise<void> {
  const settings = await getRelaySettings();
  const connectedDiv = document.getElementById('channels-connected')!;
  const statusSpan = document.getElementById('relay-status')!;
  const disconnectBtn = document.getElementById('btn-relay-disconnect') as HTMLButtonElement;
  const urlInput = document.getElementById('relay-server-url') as HTMLInputElement;

  if (settings) {
    urlInput.value = settings.serverUrl;
    urlInput.disabled = true;
    disconnectBtn.style.display = '';
    statusSpan.textContent = 'Verifying connection...';
    statusSpan.style.color = 'var(--text-secondary)';
    connectedDiv.style.display = '';

    // Ensure the background service worker is polling and WS is connected
    chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: settings.pollIntervalMinutes || 1 });

    // Load and render channels — auto-re-register if server lost our session
    try {
      channelLog('Verifying connection and loading channels...');
      const config: RelayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };
      const channels = await relayListChannels(config);
      channelLog(`Loaded ${channels.length} channel(s)`);
      statusSpan.textContent = `Connected as ${settings.userId.slice(0, 8)}...`;
      statusSpan.style.color = 'var(--success, #4caf50)';
      renderChannelsList(channels, config, settings.serverUrl);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // If auth failed (401), the server likely restarted and lost our session — auto-re-register
      if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        channelLog('Session expired or server restarted. Re-registering...');
        try {
          const { userId, apiKey } = await registerWithRelay(settings.serverUrl);
          channelLog(`Re-registered. New user ID: ${userId.slice(0, 8)}...`);
          const newSettings: RelaySettings = {
            ...settings,
            userId,
            apiKey,
          };
          await setRelaySettings(newSettings);
          chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: settings.pollIntervalMinutes || 1 });

          // Retry loading channels with new credentials
          const config2: RelayConfig = { serverUrl: settings.serverUrl, apiKey };
          const channels = await relayListChannels(config2);
          channelLog(`Loaded ${channels.length} channel(s) after re-registration`);
          statusSpan.textContent = `Connected as ${userId.slice(0, 8)}... (re-registered)`;
          statusSpan.style.color = 'var(--success, #4caf50)';
          renderChannelsList(channels, config2, settings.serverUrl);
        } catch (reregErr) {
          const reregMsg = reregErr instanceof Error ? reregErr.message : String(reregErr);
          channelLog(`Re-registration failed: ${reregMsg}`);
          statusSpan.textContent = `Disconnected (server unreachable)`;
          statusSpan.style.color = 'var(--danger, red)';
        }
      } else {
        console.error('Failed to load channels:', err);
        channelLog(`Failed to load channels: ${errMsg}`);
        statusSpan.textContent = 'Connected (failed to load channels)';
        statusSpan.style.color = 'var(--warning, orange)';
      }
    }
  } else {
    urlInput.value = urlInput.value || DEFAULT_RELAY_URL;
    urlInput.disabled = false;
    disconnectBtn.style.display = 'none';
    statusSpan.textContent = '';
    connectedDiv.style.display = 'none';
  }
  updateRelayUrlLabel();
}

function renderChannelsList(channels: Array<{ id: string; type: string; agentId: string; enabled: boolean; metadata: Record<string, unknown> }>, config: RelayConfig, serverUrl: string): void {
  const listDiv = document.getElementById('channels-list')!;
  if (channels.length === 0) {
    listDiv.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">No channels configured. Add a channel to get started.</p>';
    return;
  }

  listDiv.innerHTML = '';
  for (const ch of channels) {
    const card = document.createElement('div');
    card.style.cssText = 'padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);';

    let detailHtml = '';
    if (ch.type === 'webhook') {
      const webhookUrl = `${serverUrl}/webhook/${ch.id}?token=${ch.metadata['webhookSecret'] || ''}`;
      detailHtml = `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;word-break:break-all;"><code>${webhookUrl}</code></div>`;
    } else if (ch.type === 'telegram') {
      const botUsername = ch.metadata['botUsername'] as string || 'unknown';
      const allowedUsers = (ch.metadata['allowedUsers'] as string[] || []).join(', ');
      detailHtml = `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">Bot: @${botUsername}</div>`;
      const pendingCode = ch.metadata['pairingCode'] as string | undefined;
      if (pendingCode) {
        detailHtml += `<div style="font-size:var(--text-xs);margin-top:4px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-focus);border-radius:4px;">
          <strong style="color:var(--text-primary);">Pairing required:</strong> Send <code style="background:var(--bg-base);padding:1px 4px;border-radius:2px;">${escapeHtml(pendingCode)}</code> to @${escapeHtml(botUsername)} in Telegram to authorize yourself.
        </div>`;
      }
      detailHtml += `
        <details style="margin-top:6px;font-size:var(--text-xs);">
          <summary style="cursor:pointer;color:var(--text-secondary);user-select:none;">Allowed Users${allowedUsers ? ` (${(ch.metadata['allowedUsers'] as string[]).length})` : ''}</summary>
          <div style="margin-top:4px;">
            <p style="color:var(--text-muted);margin-bottom:4px;">Comma-separated Telegram user IDs. Leave empty to allow everyone.</p>
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="text" class="allowlist-input" data-channel-id="${ch.id}" value="${escapeHtml(allowedUsers)}" placeholder="e.g. 123456789, 987654321" style="flex:1;padding:4px 6px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
              <button class="btn btn-primary btn-xs btn-save-allowlist" data-channel-id="${ch.id}">Save</button>
            </div>
            <p style="color:var(--text-muted);margin-top:4px;">Tip: message the bot and check server logs to find your Telegram user ID.</p>
          </div>
        </details>`;
    }

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:var(--text-sm);">${ch.type}: ${ch.id.slice(0, 8)}...</strong>
        <button class="btn btn-ghost btn-remove-channel" data-channel-id="${ch.id}" style="color:var(--danger, red);font-size:var(--text-xs);">Remove</button>
      </div>
      ${detailHtml}
      <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">Agent: ${ch.agentId || '(default)'} | ${ch.enabled ? 'Enabled' : 'Disabled'}</div>
    `;
    listDiv.appendChild(card);
  }

  // Attach remove handlers
  listDiv.querySelectorAll('.btn-remove-channel').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const channelId = (btn as HTMLElement).dataset.channelId!;
      try {
        channelLog(`Removing channel ${channelId.slice(0, 8)}...`);
        await relayRemoveChannel(config, channelId);
        channelLog('Channel removed');
        await renderChannelsUI();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        channelLog(`Failed to remove channel: ${errMsg}`);
        alert(`Failed to remove channel: ${errMsg}`);
      }
    });
  });

  // Attach allowlist save handlers
  listDiv.querySelectorAll('.btn-save-allowlist').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const channelId = (btn as HTMLElement).dataset.channelId!;
      const input = listDiv.querySelector(`.allowlist-input[data-channel-id="${channelId}"]`) as HTMLInputElement;
      if (!input) return;
      const allowedUsers = input.value.split(',').map(s => s.trim()).filter(Boolean);
      try {
        channelLog(`Updating allowlist for ${channelId.slice(0, 8)}... (${allowedUsers.length} users)`);
        await relayUpdateChannel(config, channelId, { metadata: { allowedUsers } });
        channelLog('Allowlist updated');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        channelLog(`Failed to update allowlist: ${errMsg}`);
        alert(`Failed: ${errMsg}`);
      }
    });
  });
}

document.getElementById('btn-relay-connect')!.addEventListener('click', async () => {
  const urlInput = document.getElementById('relay-server-url') as HTMLInputElement;
  const statusSpan = document.getElementById('relay-status')!;
  const serverUrl = urlInput.value.trim().replace(/\/$/, '');

  if (!serverUrl) {
    statusSpan.textContent = 'Enter a server URL';
    statusSpan.style.color = 'var(--danger, red)';
    return;
  }

  statusSpan.textContent = 'Connecting...';
  statusSpan.style.color = 'var(--text-secondary)';
  channelLog(`Connecting to relay server at ${serverUrl}...`);

  try {
    // Check health first
    const healthResp = await fetch(`${serverUrl}/health`);
    if (!healthResp.ok) throw new Error('Server not reachable');
    channelLog('Server health check passed');

    // Register
    const { userId, apiKey } = await registerWithRelay(serverUrl);
    channelLog(`Registration successful. User ID: ${userId.slice(0, 8)}...`);

    const settings: RelaySettings = {
      serverUrl,
      apiKey,
      userId,
      pollIntervalMinutes: 1,
      lastPollTimestamp: new Date().toISOString(),
    };
    await setRelaySettings(settings);

    // Start polling via message to background
    chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: 1 });
    channelLog('Polling started (interval: 1 minute)');

    await renderChannelsUI();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    channelLog(`Registration failed: ${errMsg}`);
    statusSpan.textContent = `Failed: ${errMsg}`;
    statusSpan.style.color = 'var(--danger, red)';
  }
});

document.getElementById('btn-relay-disconnect')!.addEventListener('click', async () => {
  channelLog('Disconnecting from relay server...');
  await clearRelaySettings();
  chrome.runtime.sendMessage({ type: 'stopChannelPolling' });
  channelLog('Disconnected');
  await renderChannelsUI();
});

// Relay URL default/reset handling
document.getElementById('relay-server-url')!.addEventListener('input', () => {
  updateRelayUrlLabel();
});

document.getElementById('btn-relay-url-reset')!.addEventListener('click', () => {
  const urlInput = document.getElementById('relay-server-url') as HTMLInputElement;
  urlInput.value = DEFAULT_RELAY_URL;
  updateRelayUrlLabel();
});

// Channel type picker
document.getElementById('btn-add-channel')!.addEventListener('click', () => {
  const picker = document.getElementById('channel-type-picker')!;
  picker.style.display = picker.style.display === 'none' ? '' : 'none';
  // Hide telegram setup if open
  document.getElementById('telegram-setup')!.style.display = 'none';
});

document.getElementById('btn-add-webhook')!.addEventListener('click', async () => {
  const settings = await getRelaySettings();
  if (!settings) return;

  const config: RelayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };

  try {
    channelLog('Adding webhook channel...');
    const result = await relayRegisterChannel(config, { type: 'webhook', agentId: '', enabled: true, metadata: {} });
    channelLog(`Channel added: ${result.channel.id.slice(0, 8)}...`);
    document.getElementById('channel-type-picker')!.style.display = 'none';
    await renderChannelsUI();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    channelLog(`Failed to add webhook channel: ${errMsg}`);
    alert(`Failed to add channel: ${errMsg}`);
  }
});

document.getElementById('btn-add-telegram')!.addEventListener('click', () => {
  document.getElementById('channel-type-picker')!.style.display = 'none';
  document.getElementById('telegram-setup')!.style.display = '';
  (document.getElementById('telegram-bot-token') as HTMLInputElement).value = '';
  document.getElementById('telegram-status')!.textContent = '';
});

document.getElementById('btn-telegram-cancel')!.addEventListener('click', () => {
  document.getElementById('telegram-setup')!.style.display = 'none';
});

function showPairingDialog(botUsername: string, pairingCode: string): void {
  // Remove any existing pairing dialog
  document.getElementById('pairing-dialog')?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = 'pairing-dialog';
  dialog.style.cssText = `
    background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border-default);
    border-radius:12px;padding:0;max-width:440px;width:90%;font-family:var(--font-sans);
    margin:auto;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  `;
  dialog.innerHTML = `
    <div style="padding:24px;">
      <h2 style="font-size:var(--text-lg);margin-bottom:16px;">Pair with your Telegram bot</h2>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">1</div>
          <div>
            <div style="font-weight:500;font-size:var(--text-sm);">Open Telegram</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">Search for <strong>@${escapeHtml(botUsername)}</strong> or tap the link below</div>
            <a href="https://t.me/${encodeURIComponent(botUsername)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:var(--text-xs);color:var(--text-link, #58a6ff);">t.me/${escapeHtml(botUsername)}</a>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">2</div>
          <div>
            <div style="font-weight:500;font-size:var(--text-sm);">Send the pairing code</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">Copy and paste this code as a message to the bot:</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
              <code style="font-size:var(--text-lg);font-weight:600;background:var(--bg-base);padding:6px 12px;border-radius:6px;border:1px solid var(--border-default);letter-spacing:2px;">${escapeHtml(pairingCode)}</code>
              <button class="btn btn-ghost btn-xs" id="btn-copy-pairing-code" style="white-space:nowrap;">Copy</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">3</div>
          <div>
            <div style="font-weight:500;font-size:var(--text-sm);">Wait for confirmation</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">The bot will reply confirming you're authorized.</div>
          </div>
        </div>
      </div>
      <div id="pairing-status" style="margin-top:16px;padding:8px 12px;border-radius:6px;background:var(--bg-surface);font-size:var(--text-xs);color:var(--text-secondary);display:flex;align-items:center;gap:8px;">
        <span class="spinner" style="width:14px;height:14px;border:2px solid var(--border-default);border-top-color:var(--text-primary);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></span>
        Waiting for you to send the code...
      </div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" id="btn-close-pairing-dialog">Done</button>
      </div>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;

  document.body.appendChild(dialog);
  dialog.showModal();

  // Click backdrop to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.querySelector('#btn-copy-pairing-code')!.addEventListener('click', () => {
    navigator.clipboard.writeText(pairingCode).then(() => {
      const btn = dialog.querySelector('#btn-copy-pairing-code')!;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  });

  dialog.querySelector('#btn-close-pairing-dialog')!.addEventListener('click', () => {
    dialog.close();
  });

  // Poll for pairing completion — check if the pairingCode was consumed
  let pollCount = 0;
  const maxPolls = 60; // 5 minutes at 5s intervals
  const pairingPollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount > maxPolls) {
      clearInterval(pairingPollInterval);
      return;
    }
    try {
      const settings = await getRelaySettings();
      if (!settings) return;
      const config: RelayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };
      const channels = await relayListChannels(config);
      // Find the channel for this bot and check if pairingCode is gone
      const ch = channels.find(c => c.metadata?.['botUsername'] === botUsername);
      if (ch && !ch.metadata?.['pairingCode']) {
        // Pairing completed!
        clearInterval(pairingPollInterval);
        const statusEl = dialog.querySelector('#pairing-status');
        if (statusEl) {
          statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg> <span style="color:#3fb950;font-weight:500;">Paired successfully!</span>';
        }
        channelLog('Telegram bot paired successfully');
        // Auto-close after a brief delay and refresh
        setTimeout(() => {
          dialog.close();
          renderChannelsUI();
        }, 1500);
      }
    } catch {
      // Ignore poll errors
    }
  }, 5000);

  dialog.addEventListener('close', () => {
    clearInterval(pairingPollInterval);
    dialog.remove();
    renderChannelsUI(); // Always refresh on close
  });
}

document.getElementById('btn-telegram-validate')!.addEventListener('click', async () => {
  const settings = await getRelaySettings();
  if (!settings) return;

  const tokenInput = document.getElementById('telegram-bot-token') as HTMLInputElement;
  const statusSpan = document.getElementById('telegram-status')!;
  const botToken = tokenInput.value.trim();

  if (!botToken) {
    statusSpan.textContent = 'Enter a bot token';
    statusSpan.style.color = 'var(--danger, red)';
    return;
  }

  statusSpan.textContent = 'Validating...';
  statusSpan.style.color = 'var(--text-secondary)';
  channelLog('Registering Telegram bot...');

  const config: RelayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };

  try {
    const result = await registerTelegramChannel(config, botToken) as { channelId: string; botUsername: string; pairingCode?: string };
    channelLog(`Telegram bot connected: @${result.botUsername}`);
    statusSpan.textContent = `Connected as @${result.botUsername}`;
    statusSpan.style.color = 'var(--success, #4caf50)';
    tokenInput.value = '';

    // Show pairing dialog with step-by-step instructions
    if (result.pairingCode) {
      channelLog(`Pairing code: ${result.pairingCode} — send this to @${result.botUsername} in Telegram`);
      showPairingDialog(result.botUsername, result.pairingCode);
    }

    // Hide setup form and refresh
    document.getElementById('telegram-setup')!.style.display = 'none';
    await renderChannelsUI();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    channelLog(`Telegram registration failed: ${errMsg}`);
    statusSpan.textContent = `Failed: ${errMsg}`;
    statusSpan.style.color = 'var(--danger, red)';
  }
});

// ══════════════════════════════════════════
// ── Create Agent
// ══════════════════════════════════════════

const createAgentModal = document.getElementById('create-agent-modal')!;
const createCancelBtn = document.getElementById('btn-create-cancel')!;
const createConfirmBtn = document.getElementById('btn-create-confirm')!;

function showCreateAgentModal(): void {
  (document.getElementById('create-agent-name') as HTMLInputElement).value = '';
  (document.getElementById('create-agent-role') as HTMLSelectElement).value = 'neutral';
  (document.getElementById('create-agent-visibility') as HTMLSelectElement).value = 'private';
  createAgentModal.classList.add('visible');
  (document.getElementById('create-agent-name') as HTMLInputElement).focus();
}

document.getElementById('btn-add-agent')!.addEventListener('click', showCreateAgentModal);

createCancelBtn.addEventListener('click', () => {
  createAgentModal.classList.remove('visible');
});

createConfirmBtn.addEventListener('click', async () => {
  const nameInput = document.getElementById('create-agent-name') as HTMLInputElement;
  const roleSelect = document.getElementById('create-agent-role') as HTMLSelectElement;
  const visibilitySelect = document.getElementById('create-agent-visibility') as HTMLSelectElement;
  const name = nameInput.value.trim();
  if (!name) return;
  const role = roleSelect.value;
  const visibility = visibilitySelect?.value || 'private';
  createAgentModal.classList.remove('visible');

  if (port) {
    sendPortMessage({ type: 'createAgent', name, role, visibility });
  } else {
    try {
      await sendMsg({ type: 'createAgent', name, role, visibility });
      sendPortMessage({ type: 'listAgents' });
    } catch (err) {
      { const c = getFocusedColumn(); if (c) addChatSystemMessageToColumn(c, `Failed to create agent: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }
});

createAgentModal.addEventListener('click', (e) => {
  if (e.target === createAgentModal) createAgentModal.classList.remove('visible');
});

// ══════════════════════════════════════════
// ── Confirm Dialog
// ══════════════════════════════════════════

let confirmCallback: (() => void) | null = null;

function showConfirm(title: string, message: string, onConfirm: () => void): void {
  document.getElementById('confirm-title')!.textContent = title;
  document.getElementById('confirm-message')!.textContent = message;
  confirmCallback = onConfirm;
  document.getElementById('confirm-overlay')!.classList.add('visible');
}

document.getElementById('confirm-cancel')!.addEventListener('click', () => {
  document.getElementById('confirm-overlay')!.classList.remove('visible');
  confirmCallback = null;
});

document.getElementById('confirm-ok')!.addEventListener('click', () => {
  document.getElementById('confirm-overlay')!.classList.remove('visible');
  if (confirmCallback) {
    confirmCallback();
    confirmCallback = null;
  }
});

document.getElementById('confirm-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirm-overlay')) {
    document.getElementById('confirm-overlay')!.classList.remove('visible');
    confirmCallback = null;
  }
});

// ══════════════════════════════════════════
// ── Hooks View
// ══════════════════════════════════════════

function loadHooksView(): void {
  if (!activeAgentId || !port) return;

  const listEl = document.getElementById('hooks-list')!;
  listEl.innerHTML = '<p style="color:var(--text-muted);padding:12px;">Loading...</p>';

  sendPortMessage({ type: 'getHooks', agentId: activeAgentId });
}

function renderHooksList(hooks: Hook[]): void {
  const listEl = document.getElementById('hooks-list')!;

  if (hooks.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <h3>No hooks</h3>
        <p>Hooks let your agent respond to browser events automatically. Create one to get started, or ask your agent to set up hooks via chat.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = hooks.map((hook) => {
    const triggerLabel = formatTrigger(hook.trigger);
    const lastTriggered = hook.lastTriggeredAt ? relativeTime(hook.lastTriggeredAt) : 'never';

    return `
      <div class="settings-card" style="margin-bottom:8px;" data-hook-id="${escapeHtml(hook.id)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <strong>${escapeHtml(hook.description)}</strong>
              <span class="badge" style="background:${hook.enabled ? 'var(--success-subtle)' : 'var(--danger-subtle)'};color:${hook.enabled ? 'var(--success-text)' : 'var(--danger-text)'};">${hook.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:var(--text-sm);">
              <span style="font-weight:500;">Trigger:</span> ${escapeHtml(triggerLabel)}
            </div>
            <div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:4px;">
              Fired ${hook.triggerCount} time${hook.triggerCount !== 1 ? 's' : ''} &middot; Last: ${escapeHtml(lastTriggered)}
            </div>
            <details style="margin-top:6px;">
              <summary style="font-size:var(--text-xs);color:var(--accent-text);cursor:pointer;user-select:none;">Show prompt</summary>
              <div style="margin-top:4px;padding:8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:var(--text-xs);white-space:pre-wrap;word-break:break-word;color:var(--text-secondary);max-height:150px;overflow-y:auto;">${escapeHtml(hook.prompt)}</div>
            </details>
          </div>
          <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm hook-edit-btn" data-hook-id="${escapeHtml(hook.id)}" title="Edit hook">
              Edit
            </button>
            <button class="btn btn-ghost btn-sm hook-toggle-btn" data-hook-id="${escapeHtml(hook.id)}" data-enabled="${hook.enabled}" title="${hook.enabled ? 'Disable' : 'Enable'}">
              ${hook.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-ghost btn-sm hook-delete-btn" data-hook-id="${escapeHtml(hook.id)}" title="Delete hook" style="color:var(--danger-text);">
              Delete
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Attach event listeners
  listEl.querySelectorAll<HTMLButtonElement>('.hook-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hookId = btn.dataset.hookId!;
      const currentlyEnabled = btn.dataset.enabled === 'true';
      sendPortMessage({ type: 'updateHook', hookId, updates: { enabled: !currentlyEnabled } });
      // Optimistic refresh
      setTimeout(() => loadHooksView(), 200);
    });
  });

  listEl.querySelectorAll<HTMLButtonElement>('.hook-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hookId = btn.dataset.hookId!;
      sendPortMessage({ type: 'removeHook', hookId });
      // Optimistic refresh
      setTimeout(() => loadHooksView(), 200);
    });
  });

  // Edit buttons - populate the create form with existing hook data
  listEl.querySelectorAll<HTMLButtonElement>('.hook-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hookId = btn.dataset.hookId!;
      const hook = hooks.find((h) => h.id === hookId);
      if (!hook) return;

      // Populate the form
      (document.getElementById('hook-description') as HTMLInputElement).value = hook.description;
      hooksTriggerType.value = hook.trigger.type;
      updateTriggerFilters();

      // Fill trigger-specific filters
      setTimeout(() => {
        if ('label' in hook.trigger) {
          const labelInput = document.querySelector('#hook-trigger-filters input') as HTMLInputElement | null;
          if (labelInput) labelInput.value = (hook.trigger as { label: string }).label;
        }
        if ('urlPattern' in hook.trigger) {
          const urlInput = document.querySelector('#hook-trigger-filters input') as HTMLInputElement | null;
          if (urlInput) urlInput.value = (hook.trigger as { urlPattern: string }).urlPattern;
        }
        if ('folderId' in hook.trigger) {
          const folderSelect = document.querySelector('#hook-filter-folder') as HTMLSelectElement | null;
          if (folderSelect) folderSelect.value = (hook.trigger as { folderId?: string }).folderId || '';
        }
        if ('filenamePattern' in hook.trigger) {
          const fnInput = document.querySelector('#hook-trigger-filters input') as HTMLInputElement | null;
          if (fnInput) fnInput.value = (hook.trigger as { filenamePattern?: string }).filenamePattern || '';
        }
        if ('state' in hook.trigger) {
          const stateSelect = document.querySelector('#hook-trigger-filters select') as HTMLSelectElement | null;
          if (stateSelect) stateSelect.value = (hook.trigger as { state: string }).state;
        }
        if ('keyword' in hook.trigger) {
          const kwInput = document.querySelector('#hook-trigger-filters input') as HTMLInputElement | null;
          if (kwInput) kwInput.value = (hook.trigger as { keyword: string }).keyword;
        }
      }, 50);

      (document.getElementById('hook-prompt') as HTMLTextAreaElement).value = hook.prompt;

      // Show the form
      document.getElementById('hooks-create-form')!.style.display = 'block';

      // Track which hook we're editing (deleted only on save, not on edit click)
      editingHookId = hookId;
    });
  });
}

function formatTrigger(trigger: HookTrigger): string {
  switch (trigger.type) {
    case 'bookmark-created':
      return `Bookmark created${trigger.folderId ? ` (folder: ${trigger.folderName || trigger.folderId})` : ''}`;
    case 'tab-navigated':
      return `Tab navigated to ${trigger.urlPattern}`;
    case 'tab-created':
      return 'Tab created';
    case 'tab-closed':
      return 'Tab closed';
    case 'download-completed':
      return `Download completed${trigger.filenamePattern ? ` (${trigger.filenamePattern})` : ''}`;
    case 'history-visited':
      return `Visited URL matching ${trigger.urlPattern}`;
    case 'idle-changed':
      return `Idle state changed to ${trigger.state}`;
    case 'browser-startup':
      return 'Browser startup';
    case 'omnibox':
      return `Omnibox keyword: "${trigger.keyword}"`;
    case 'context-menu':
      return `Context menu: "${trigger.label}"`;
    default:
      return (trigger as HookTrigger).type;
  }
}

// ── Hooks create form ──

const hooksTriggerType = document.getElementById('hook-trigger-type') as HTMLSelectElement;
let editingHookId: string | null = null; // Set when editing an existing hook
const hooksTriggerFilters = document.getElementById('hook-trigger-filters')!;

function updateTriggerFilters(): void {
  const type = hooksTriggerType.value;
  let html = '';

  switch (type) {
    case 'bookmark-created':
      html = `
        <div class="settings-field">
          <label for="hook-filter-folder">Bookmark Folder (optional, watch a specific folder)</label>
          <select id="hook-filter-folder" style="width:100%;">
            <option value="">Any folder</option>
          </select>
          <input type="hidden" id="hook-filter-folder-id">
          <input type="hidden" id="hook-filter-folder-name">
        </div>`;
      // Populate folder picker async
      (async () => {
        try {
          const hasBm = await chrome.permissions.contains({ permissions: ['bookmarks'] });
          if (!hasBm) {
            const sel = document.getElementById('hook-filter-folder') as HTMLSelectElement | null;
            if (sel) {
              sel.innerHTML = '<option value="">Enable bookmarks permission in settings first</option>';
              sel.disabled = true;
            }
            return;
          }
          const tree = await chrome.bookmarks.getTree();
          const folders: { id: string; title: string; depth: number }[] = [];
          function walkFolders(nodes: chrome.bookmarks.BookmarkTreeNode[], depth: number) {
            for (const node of nodes) {
              if (node.children) {
                folders.push({ id: node.id, title: node.title || '(root)', depth });
                walkFolders(node.children, depth + 1);
              }
            }
          }
          walkFolders(tree, 0);
          const sel = document.getElementById('hook-filter-folder') as HTMLSelectElement | null;
          if (sel) {
            sel.innerHTML = '<option value="">Any folder</option>' +
              folders.map(f => `<option value="${f.id}" data-name="${escapeHtml(f.title)}">${'  '.repeat(f.depth)}${escapeHtml(f.title)}</option>`).join('');
            sel.addEventListener('change', () => {
              const opt = sel.selectedOptions[0];
              (document.getElementById('hook-filter-folder-id') as HTMLInputElement).value = sel.value;
              (document.getElementById('hook-filter-folder-name') as HTMLInputElement).value = opt?.dataset.name || '';
            });
          }
        } catch {
          // Bookmarks permission not granted
        }
      })();
      break;
    case 'tab-navigated':
    case 'history-visited':
      html = `
        <div class="settings-field">
          <label for="hook-filter-url-pattern">URL Pattern (glob, e.g. *github.com/*)</label>
          <input type="text" id="hook-filter-url-pattern" placeholder="*.example.com/*">
        </div>`;
      break;
    case 'download-completed':
      html = `
        <div class="settings-field">
          <label for="hook-filter-filename">Filename Pattern (optional, e.g. *.pdf)</label>
          <input type="text" id="hook-filter-filename" placeholder="*.pdf">
        </div>`;
      break;
    case 'idle-changed':
      html = `
        <div class="settings-field">
          <label for="hook-filter-idle-state">State</label>
          <select id="hook-filter-idle-state">
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="locked">Locked</option>
          </select>
        </div>`;
      break;
    case 'omnibox':
      html = `
        <div class="settings-field">
          <label for="hook-filter-keyword">Keyword (text after "chaos " in address bar)</label>
          <input type="text" id="hook-filter-keyword" placeholder="e.g. summarize">
        </div>`;
      break;
    case 'context-menu':
      html = `
        <div class="settings-field">
          <label for="hook-filter-label">Menu Item Label</label>
          <input type="text" id="hook-filter-label" placeholder="e.g. Summarize this page">
        </div>`;
      break;
    // tab-created, tab-closed, browser-startup have no filters
  }

  hooksTriggerFilters.innerHTML = html;
}

hooksTriggerType.addEventListener('change', updateTriggerFilters);

// ── Hook Presets ──

const HOOK_PRESETS = [
  { label: 'Summarize bookmarks', description: 'Summarize new bookmarks', trigger: 'bookmark-created', prompt: 'A new bookmark was added. Read the bookmarked page content, write a brief summary to memories/bookmarks/, and note any action items in TODO.md.' },
  { label: 'Morning briefing', description: 'Daily morning briefing on browser startup', trigger: 'browser-startup', prompt: 'Good morning! Review my recent browsing history, check for any pending TODOs, and give me a brief morning briefing of what I was working on and what might need attention today.' },
  { label: 'Track GitHub activity', description: 'Track when I visit GitHub repos', trigger: 'tab-navigated', filter: '*.github.com/*', prompt: 'The user navigated to a GitHub page. Note the repository name and what they might be working on. Update memories/projects.md with any new repos.' },
  { label: 'Download organizer', description: 'Log and categorize downloads', trigger: 'download-completed', prompt: 'A file was downloaded. Note the filename and source in memories/downloads.md. If it looks like a document or resource, suggest how to use it.' },
  { label: 'Reading list reviewer', description: 'Review reading list changes', trigger: 'reading-list-changed', prompt: 'The reading list was updated. Check the current reading list items, summarize any new additions, and suggest which to read next based on my interests.' },
  { label: 'Away report', description: 'Generate a report when I return from idle', trigger: 'idle-changed', filter: 'active', prompt: 'The user just returned from being away. Check what tabs are open, review any pending messages from other agents, and provide a quick summary of what might need attention.' },
  { label: 'Summarize this page', description: 'Summarize page content from context menu', trigger: 'context-menu', filter: 'Summarize this page', prompt: 'Read and summarize the content that was shared with you.' },
  { label: 'Explain this', description: 'Explain selected text from context menu', trigger: 'context-menu', filter: 'Explain this', prompt: 'Explain the selected text in simple terms.' },
  { label: 'Save to memory', description: 'Save content to memories from context menu', trigger: 'context-menu', filter: 'Save to memory', prompt: 'Save the shared content to your memories with appropriate categorization.' },
];

function renderHookPresets(): void {
  const grid = document.getElementById('hooks-presets-grid');
  if (!grid) return;
  grid.innerHTML = HOOK_PRESETS.map((p, i) => `
    <button class="btn btn-ghost btn-sm" data-preset="${i}" style="font-size:var(--text-xs);">
      ${escapeHtml(p.label)}
    </button>
  `).join('');

  grid.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = HOOK_PRESETS[parseInt(btn.dataset.preset!, 10)];
      // Fill the form with preset values
      (document.getElementById('hook-description') as HTMLInputElement).value = preset.description;
      hooksTriggerType.value = preset.trigger;
      updateTriggerFilters();
      (document.getElementById('hook-prompt') as HTMLTextAreaElement).value = preset.prompt;
      // Fill filter if applicable
      if (preset.filter) {
        setTimeout(() => {
          const filterInput = document.querySelector('#hook-trigger-filters input') as HTMLInputElement | null;
          if (filterInput) filterInput.value = preset.filter;
          const filterSelect = document.querySelector('#hook-trigger-filters select') as HTMLSelectElement | null;
          if (filterSelect) filterSelect.value = preset.filter;
        }, 50);
      }
      // Show the form
      document.getElementById('hooks-create-form')!.style.display = 'block';
    });
  });
}

// Render presets when hooks view loads
renderHookPresets();

document.getElementById('hooks-btn-create')!.addEventListener('click', () => {
  const form = document.getElementById('hooks-create-form')!;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  updateTriggerFilters();
});

document.getElementById('hooks-btn-cancel')!.addEventListener('click', () => {
  document.getElementById('hooks-create-form')!.style.display = 'none';
  editingHookId = null; // Cancel editing without deleting
});

document.getElementById('hooks-btn-save')!.addEventListener('click', () => {
  if (!activeAgentId || !port) return;

  const description = (document.getElementById('hook-description') as HTMLInputElement).value.trim();
  const prompt = (document.getElementById('hook-prompt') as HTMLTextAreaElement).value.trim();
  const triggerType = hooksTriggerType.value;

  if (!description || !prompt) {
    return; // Basic validation
  }

  let trigger: HookTrigger;

  switch (triggerType) {
    case 'bookmark-created': {
      const folderId = (document.getElementById('hook-filter-folder-id') as HTMLInputElement)?.value.trim() || undefined;
      const folderName = (document.getElementById('hook-filter-folder-name') as HTMLInputElement)?.value.trim() || undefined;
      trigger = { type: 'bookmark-created', folderId, folderName };
      break;
    }
    case 'tab-navigated': {
      const urlPattern = (document.getElementById('hook-filter-url-pattern') as HTMLInputElement)?.value.trim() || '*';
      trigger = { type: 'tab-navigated', urlPattern };
      break;
    }
    case 'tab-created':
      trigger = { type: 'tab-created' };
      break;
    case 'tab-closed':
      trigger = { type: 'tab-closed' };
      break;
    case 'download-completed': {
      const filenamePattern = (document.getElementById('hook-filter-filename') as HTMLInputElement)?.value.trim() || undefined;
      trigger = { type: 'download-completed', filenamePattern };
      break;
    }
    case 'history-visited': {
      const urlPattern = (document.getElementById('hook-filter-url-pattern') as HTMLInputElement)?.value.trim() || '*';
      trigger = { type: 'history-visited', urlPattern };
      break;
    }
    case 'idle-changed': {
      const state = (document.getElementById('hook-filter-idle-state') as HTMLSelectElement)?.value as 'active' | 'idle' | 'locked';
      trigger = { type: 'idle-changed', state };
      break;
    }
    case 'browser-startup':
      trigger = { type: 'browser-startup' };
      break;
    case 'omnibox': {
      const keyword = (document.getElementById('hook-filter-keyword') as HTMLInputElement)?.value.trim() || '';
      if (!keyword) return;
      trigger = { type: 'omnibox', keyword };
      break;
    }
    case 'context-menu': {
      const label = (document.getElementById('hook-filter-label') as HTMLInputElement)?.value.trim() || '';
      if (!label) return;
      trigger = { type: 'context-menu', label };
      break;
    }
    default:
      return;
  }

  const hook: Hook = {
    id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: activeAgentId,
    trigger,
    prompt,
    description,
    enabled: true,
    createdAt: new Date().toISOString(),
    triggerCount: 0,
  };

  // If editing, delete the old hook first
  if (editingHookId) {
    sendPortMessage({ type: 'removeHook', hookId: editingHookId });
    editingHookId = null;
  }

  sendPortMessage({ type: 'addHook', hook });

  // Reset form
  (document.getElementById('hook-description') as HTMLInputElement).value = '';
  (document.getElementById('hook-prompt') as HTMLTextAreaElement).value = '';
  document.getElementById('hooks-create-form')!.style.display = 'none';

  // Refresh
  setTimeout(() => loadHooksView(), 200);
});

// ══════════════════════════════════════════
// ── Refine Prompt
// ══════════════════════════════════════════

// State: which textarea triggered the refine
let refineTargetTextarea: HTMLTextAreaElement | null = null;

const refineModal = document.getElementById('refine-modal')!;
const refineOriginal = document.getElementById('refine-original')!;
const refineResult = document.getElementById('refine-result') as HTMLTextAreaElement;
const refineLoading = document.getElementById('refine-loading')!;
const refineAcceptBtn = document.getElementById('refine-accept') as HTMLButtonElement;
const refineRejectBtn = document.getElementById('refine-reject') as HTMLButtonElement;

function openRefineModal(textarea: HTMLTextAreaElement, context: string): void {
  const prompt = textarea.value.trim();
  if (!prompt) return;

  refineTargetTextarea = textarea;
  refineOriginal.textContent = prompt;
  refineResult.value = '';
  refineResult.style.display = 'none';
  refineLoading.style.display = 'flex';
  refineAcceptBtn.disabled = true;
  refineModal.classList.add('visible');

  // Send to background for refinement
  sendMsg<{ refined?: string; error?: string }>({ type: 'refinePrompt', prompt, context })
    .then((resp) => {
      refineLoading.style.display = 'none';
      if (resp.refined) {
        refineResult.value = resp.refined;
        refineResult.style.display = '';
        refineAcceptBtn.disabled = false;
      } else {
        refineResult.value = '(Failed to refine prompt)';
        refineResult.style.display = '';
      }
    })
    .catch((err) => {
      refineLoading.style.display = 'none';
      refineResult.value = `(Error: ${err instanceof Error ? err.message : 'Failed to refine prompt. Check your API key in Global Settings.'})`;
      refineResult.style.display = '';
    });
}

function closeRefineModal(): void {
  refineModal.classList.remove('visible');
  refineTargetTextarea = null;
}

refineAcceptBtn.addEventListener('click', () => {
  if (refineTargetTextarea && refineResult.value) {
    refineTargetTextarea.value = refineResult.value;
  }
  closeRefineModal();
});

refineRejectBtn.addEventListener('click', () => {
  closeRefineModal();
});

// Close on overlay click
refineModal.addEventListener('click', (e) => {
  if (e.target === refineModal) closeRefineModal();
});

// Hook prompt refine button
document.getElementById('hook-refine-btn')!.addEventListener('click', () => {
  const textarea = document.getElementById('hook-prompt') as HTMLTextAreaElement;
  const triggerType = (document.getElementById('hook-trigger-type') as HTMLSelectElement).value;
  openRefineModal(textarea, `Hook prompt for a "${triggerType}" trigger`);
});

// ══════════════════════════════════════════
// ── Initial load
// ══════════════════════════════════════════

async function init(): Promise<void> {
  // Connect the port for chat streaming
  port = connectPort();
  sendPortMessage({ type: 'listAgents' });
}

// Handle browser back/forward
window.addEventListener('hashchange', () => {
  const hashState = parseHash();
  if (hashState.view === 'global-settings') {
    showGlobalSettings(false); // false = don't update hash (it already changed)
  } else if (hashState.agentId && agents.find((a) => a.id === hashState.agentId)) {
    if (hashState.agentId !== activeAgentId) {
      switchToAgent(hashState.agentId);
    }
    if (hashState.view !== activeView) {
      activeView = hashState.view;
      sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === activeView));
      updateViewVisibility();
      loadCurrentViewData();
    }
  }
});

init();
