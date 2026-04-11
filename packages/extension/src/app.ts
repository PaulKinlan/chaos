/**
 * Dashboard UI (app.html)
 *
 * New layout model:
 * - Top bar: Agent tabs (like browser tabs) with [+] to create
 * - Left sidebar: View navigation (Chat, Tasks, Messages, Artifacts, Files, Agent Settings)
 * - Main area: The selected view, filtered to the active agent
 * - Global settings accessible via gear icon in top bar
 *
 * Chat uses a long-lived port for streaming.
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

// ── Design system components (registers custom elements) ──
import './components/design-system/index.js';
// ── Shared components (registers chaos-sidebar, chaos-filter-bar) ──
import './components/shared/index.js';
// ── View components (registers chaos-*-view elements) ──
import './components/views/index.js';
// ── Global state signals ──
import './state/index.js';
import { agents as agentsSignal, artifacts as artifactsSignal, hooks as hooksSignal, refreshArtifacts, refreshHooks, refreshUsage, refreshTasks, refreshMessages, refreshTodayUsage, refreshSettings } from './state/app-state.js';
// ── Messaging singleton (lets Lit components call sendMsg) ──
import { setSendMsg, setSendPortMessage } from './services/messaging.js';
import type { AgentMeta, ArtifactMeta, ApiKeys, Hook, HookTrigger, AgenticProgressEntry } from './storage/types.js';
import { needsSandbox, renderInSandbox } from './ui/sandbox-renderer.js';
import { showOnboarding } from './ui/onboarding.js';
import { hasPermission } from './permissions.js';
import { listProviders } from './agents/provider-registry.js';

// ── Help content (bundled at build time) ──
import chatHelp from '../docs/help/chat.md?raw';
import jobsHelp from '../docs/help/jobs.md?raw';
import artifactsHelp from '../docs/help/artifacts.md?raw';
import channelsHelp from '../docs/help/channels.md?raw';
import hooksHelp from '../docs/help/hooks.md?raw';
import memoryHelp from '../docs/help/memory.md?raw';
import messagesHelp from '../docs/help/messages.md?raw';
import tasksHelp from '../docs/help/tasks.md?raw';
import agentSettingsHelp from '../docs/help/agent-settings.md?raw';
import globalSettingsHelp from '../docs/help/global-settings.md?raw';
import dashboardHelp from '../docs/help/dashboard.md?raw';
import usageHelp from '../docs/help/usage.md?raw';
import filesHelp from '../docs/help/files.md?raw';

// ── Configure marked ──

marked.setOptions({
  gfm: true,
  breaks: true,
});

// ── State ──

let agents: AgentMeta[] = [];

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

function roleBadgeClass(role: string): string {
  return `role-${role}`;
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
  if (result === null || result === undefined) {
    throw new Error(`No response from background for ${msg.type}. The service worker may have restarted.`);
  }
  if (typeof result === 'object' && 'error' in result && result.error) {
    throw new Error(result.error);
  }
  return result;
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
    const details = document.createElement('details');
    details.open = true;
    details.className = 'sidebar-agent-details';

    const summary = document.createElement('summary');
    summary.className = 'sidebar-agent-item' + (agent.id === activeAgentId ? ' active' : '');
    summary.dataset.agentId = agent.id;

    // Icon: star for master, user for others
    if (agent.master) {
      summary.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    } else {
      summary.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'agent-name';
    nameEl.textContent = agent.name;
    summary.appendChild(nameEl);

    // Show model subtitle when agent has a custom model override
    if (agent.provider || agent.model) {
      const modelSubEl = document.createElement('span');
      modelSubEl.className = 'agent-model-subtitle';
      const provLabel = agent.provider
        ? (listProviders().find(p => p.id === agent.provider)?.displayName || agent.provider)
        : '';
      const mdlLabel = agent.model || '';
      modelSubEl.textContent = mdlLabel ? (provLabel ? `${provLabel} / ${mdlLabel}` : mdlLabel) : provLabel;
      summary.appendChild(modelSubEl);
    }

    // Double-click to switch to agent's chat
    summary.addEventListener('dblclick', (e) => {
      e.preventDefault();
      switchToAgent(agent.id);
      activeView = 'chat';
      updateViewVisibility();
    });

    details.appendChild(summary);

    // Sub-items
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

    const tasksBtn = document.createElement('button');
    tasksBtn.className = 'sidebar-item' + (isActive && activeView === 'tasks' ? ' active' : '');
    tasksBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14l2 2 4-4"/></svg><span class="label">Tasks</span>';
    tasksBtn.addEventListener('click', () => {
      if (activeAgentId !== agent.id) switchToAgent(agent.id);
      activeView = 'tasks';
      updateHash();
      updateViewVisibility();
      const tasksViewEl = document.querySelector('chaos-tasks-view') as any;
      if (tasksViewEl) { tasksViewEl.agents = agents; tasksViewEl.activeAgentId = activeAgentId; tasksViewEl.refresh(agent.id); }
      renderAgentTabs();
    });

    const msgsBtn = document.createElement('button');
    msgsBtn.className = 'sidebar-item' + (isActive && activeView === 'messages' ? ' active' : '');
    msgsBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span class="label">Messages</span>';
    msgsBtn.addEventListener('click', () => {
      if (activeAgentId !== agent.id) switchToAgent(agent.id);
      activeView = 'messages';
      updateHash();
      updateViewVisibility();
      loadCurrentViewData();
      renderAgentTabs();
    });

    sub.appendChild(memBtn);
    sub.appendChild(msgsBtn);
    sub.appendChild(tasksBtn);
    sub.appendChild(settingsBtn);
    details.appendChild(sub);

    sidebarAgentList.appendChild(details);
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
    if (activeView === 'dashboard') {
      // Dashboard is viewable without an agent selected
      noAgentPanel.classList.remove('active');
      viewPanels.forEach((p) => {
        const viewId = p.id.replace('view-', '');
        p.classList.toggle('active', viewId === 'dashboard');
      });
      document.getElementById('view-global-settings')!.classList.remove('active');
      return;
    }
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

    if (!activeAgentId && view !== 'global-settings' && view !== 'dashboard') {
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

// ── Component event delegation ──
// Lit components fire custom events that bubble up to document.
// Handle them here to bridge between components and the rest of app.ts.

document.addEventListener('show-artifact-detail', async (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const artifact = detail?.artifact as ArtifactMeta;
  if (!artifact) return;

  // Show in the global artifact detail component — works from any view
  const detailEl = document.getElementById('global-artifact-detail') as any;
  if (detailEl && typeof detailEl.show === 'function') {
    detailEl.show(artifact);
  }
});

// When an artifact is updated (pinned/unpinned), refresh the artifacts signal.
// All views watching the signal re-render automatically.
document.addEventListener('artifact-updated', () => {
  refreshArtifacts();
});

document.addEventListener('view-change', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (!detail) return;

  const targetView = typeof detail === 'string' ? detail : detail.view;
  const prompt = typeof detail === 'object' ? detail.prompt : undefined;

  if (targetView) {
    activeView = targetView;
    sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === targetView));
    updateViewVisibility();
    loadCurrentViewData();

    // If there's a prompt, inject it into the focused chat column's input
    if (prompt && targetView === 'chat') {
      setTimeout(() => {
        const col = getFocusedColumn();
        if (col) {
          const textarea = col.columnEl.querySelector('.chat-input-area textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = prompt;
            textarea.dispatchEvent(new Event('input'));
            textarea.focus();
            console.log('[app] Injected prompt into chat:', prompt.slice(0, 80));
          } else {
            console.warn('[app] Could not find textarea in focused column');
          }
        } else {
          console.warn('[app] No focused column for prompt injection');
        }
      }, 300);
    }
  }
});

document.addEventListener('agent-change', (e: Event) => {
  const agentId = (e as CustomEvent).detail;
  if (typeof agentId === 'string') {
    switchToAgent(agentId);
  }
});

document.addEventListener('agent-deleted', () => {
  sendPortMessage({ type: 'listAgents' });
  activeAgentId = null;
  activeView = 'chat';
  sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === 'chat'));
  updateViewVisibility();
});

document.addEventListener('agent-jump', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    switchToAgent(detail.agentId);
    if (detail.view) {
      activeView = detail.view;
      sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === detail.view));
      updateViewVisibility();
      loadCurrentViewData();
    }
  }
});

document.addEventListener('create-agent', () => {
  const modal = document.getElementById('create-agent-modal');
  if (modal) modal.classList.add('visible');
});

document.addEventListener('run-scheduled-task', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const alarmId = detail?.alarmId || detail?.task?.alarmId;
  if (alarmId) {
    console.log('[app] Running scheduled task:', alarmId);
    sendMsg({ type: 'runScheduledTask', alarmId }).then(() => {
      refreshTasks();
      refreshTodayUsage();
    }).catch((err) => console.error('[app] Run scheduled task failed:', err));
  } else {
    console.warn('[app] run-scheduled-task event missing alarmId:', detail);
  }
});

document.addEventListener('rerun-smart-start', async () => {
  await chrome.storage.local.remove('chaos:smart-start-completed');
  showSmartStart();
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

  // Delegate to Lit component
  loadCurrentViewData();
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

// ══════════════════════════════════════════
// ── Help System
// ══════════════════════════════════════════

const helpContent: Record<string, { title: string; content: string }> = {
  chat: { title: 'Help: Chat', content: chatHelp },
  dashboard: { title: 'Help: Dashboard', content: dashboardHelp },
  tasks: { title: 'Help: Jobs', content: jobsHelp },
  artifacts: { title: 'Help: Artifacts', content: artifactsHelp },
  channels: { title: 'Help: Channels', content: channelsHelp },
  hooks: { title: 'Help: Hooks', content: hooksHelp },
  files: { title: 'Help: Agent Memory', content: filesHelp },
  memory: { title: 'Help: Agent Memory', content: memoryHelp },
  messages: { title: 'Help: Messages', content: messagesHelp },
  usage: { title: 'Help: Usage', content: usageHelp },
  'scheduled-tasks': { title: 'Help: Scheduled Tasks', content: tasksHelp },
  'agent-settings': { title: 'Help: Agent Settings', content: agentSettingsHelp },
  'global-settings': { title: 'Help: Global Settings', content: globalSettingsHelp },
};

// Human-readable labels for the "Ask the agent" pre-fill
const helpViewLabels: Record<string, string> = {
  chat: 'Chat',
  dashboard: 'Dashboard',
  tasks: 'Jobs',
  artifacts: 'Artifacts',
  channels: 'Channels',
  hooks: 'Hooks',
  files: 'Agent Memory',
  memory: 'Agent Memory',
  messages: 'Messages',
  usage: 'Usage & Costs',
  'scheduled-tasks': 'Scheduled Tasks',
  'agent-settings': 'Agent Settings',
  'global-settings': 'Global Settings',
};

let currentHelpView: string | null = null;

function showHelp(viewName: string): void {
  const entry = helpContent[viewName];
  if (!entry) return;

  currentHelpView = viewName;

  const dialog = document.getElementById('help-dialog') as HTMLDialogElement;
  const titleEl = document.getElementById('help-dialog-title')!;
  const bodyEl = document.getElementById('help-dialog-body')!;

  titleEl.textContent = entry.title;
  const rendered = marked.parse(entry.content);
  bodyEl.innerHTML = DOMPurify.sanitize(rendered as string);

  dialog.showModal();
}

// Wire up help dialog close buttons
const helpDialog = document.getElementById('help-dialog') as HTMLDialogElement;
document.getElementById('help-dialog-close')!.addEventListener('click', () => {
  helpDialog.close();
});
document.getElementById('help-dialog-close-btn')!.addEventListener('click', () => {
  helpDialog.close();
});

// Click backdrop to close
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog) helpDialog.close();
});

// "Ask the agent" button — switch to chat and pre-fill
document.getElementById('help-dialog-ask-agent')!.addEventListener('click', () => {
  const label = currentHelpView ? (helpViewLabels[currentHelpView] || currentHelpView) : 'this view';
  helpDialog.close();

  // Switch to chat view
  activeView = 'chat';
  sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === activeView));
  updateViewVisibility();
  updateHash();

  // Pre-fill the first chat column's input
  setTimeout(() => {
    const firstTextarea = document.querySelector('#columns-container .chat-input-area textarea') as HTMLTextAreaElement | null;
    if (firstTextarea) {
      firstTextarea.value = `I need help with ${label}`;
      firstTextarea.focus();
      // Trigger auto-resize
      firstTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 100);
});

// Wire up all help buttons (event delegation)
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.help-btn[data-help]') as HTMLElement | null;
  if (btn) {
    const viewName = btn.dataset.help;
    if (viewName) showHelp(viewName);
  }
});

async function loadCurrentViewData(): Promise<void> {
  // Helper: set properties on a Lit element, wait for render, then refresh
  async function wireAndRefresh(el: any, props: Record<string, unknown>): Promise<void> {
    if (!el) return;
    for (const [k, v] of Object.entries(props)) el[k] = v;
    await el.updateComplete;
    if (typeof el.refresh === 'function') el.refresh();
  }

  switch (activeView) {
    case 'dashboard':
      refreshArtifacts();
      await wireAndRefresh(document.querySelector('chaos-dashboard-view'), { agents });
      break;
    case 'chat':
      break;
    case 'tasks':
      await wireAndRefresh(document.querySelector('chaos-tasks-view'), { agents, activeAgentId });
      break;
    case 'messages':
      await wireAndRefresh(document.querySelector('chaos-messages-view'), { activeAgentId, agents });
      break;
    case 'artifacts':
      await wireAndRefresh(document.querySelector('chaos-artifacts-view'), { agents });
      break;
    case 'channels':
      await wireAndRefresh(document.querySelector('chaos-channels-view'), { agents });
      break;
    case 'files':
      await wireAndRefresh(document.querySelector('chaos-files-view'), { activeAgentId });
      break;
    case 'hooks':
      await wireAndRefresh(document.querySelector('chaos-hooks-view'), { agents, activeAgentId });
      break;
    case 'usage':
      await wireAndRefresh(document.querySelector('chaos-usage-view'), {});
      break;
    case 'agent-settings':
      await wireAndRefresh(document.querySelector('chaos-agent-settings-view'), { activeAgentId });
      break;
    case 'global-settings':
      await wireAndRefresh(document.querySelector('chaos-global-settings-view'), { agents });
      break;
  }
}

// ══════════════════════════════════════════
// ── Agent Tab Context Menu
// ══════════════════════════════════════════

const contextMenu = document.getElementById('agent-tab-context-menu')!;

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
  isChannelColumn?: boolean; // true if created by a channel/hook/task message, not user chat
}

let columns: ChatColumn[] = [];
const columnsContainer = document.getElementById('columns-container') as HTMLDivElement;
const columnAddPicker = document.getElementById('column-add-picker') as HTMLDivElement;

// Track which column is focused (for mention system, voice input, etc.)
let focusedColumnId: string | null = null;

function getColumnById(columnId: string): ChatColumn | undefined {
  return columns.find((c) => c.id === columnId);
}

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
  const p = chrome.runtime.connect({ name: 'chaos-ui' });

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
    console.log(`[app] Port disconnected, reconnecting for: ${msg.type}`);
    port = connectPort();
  }
  console.log(`[app] sendPortMessage: ${msg.type}`);
  port.postMessage(msg);
}

// Expose messaging to Lit view components via the singleton
setSendMsg(sendMsg);
setSendPortMessage(sendPortMessage);

function handlePortMessage(msg: Record<string, unknown>): void {
  // Route chat-related messages to the correct column by columnId (preferred) or agentId
  const msgAgentId = msg.agentId as string | undefined;
  const msgColumnId = msg.columnId as string | undefined;
  // Resolve the target column: prefer columnId (supports multiple columns per agent)
  const resolveColumn = () =>
    (msgColumnId && getColumnById(msgColumnId)) ||
    (msgAgentId && getColumnForAgent(msgAgentId)) ||
    getFocusedColumn();

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
      const col = resolveColumn();
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
      const col = resolveColumn();
      if (col && col.currentStreamEl) {
        col.currentStreamContent += msg.chunk as string;
        renderChatMarkdown(col.currentStreamEl, col.currentStreamContent);
        columnScrollToBottom(col);
      }
      break;
    }

    case 'toolCall': {
      const col = resolveColumn();
      if (col) {
        addToolCallCardToColumn(col, msg.name as string, msg.args as unknown, msg.result as unknown);
      }
      break;
    }

    case 'chatEnd': {
      const col = resolveColumn();
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
      const col = resolveColumn();
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
      // Open a column for the incoming channel message
      // Switch to chat view so the column is visible
      if (activeView !== 'chat') {
        activeView = 'chat';
        document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((b) => {
          b.classList.toggle('active', b.dataset.view === 'chat');
        });
        updateViewVisibility();
      }

      // NEVER take over the user's existing chat column
      const agentId = msg.agentId as string;
      const channelColId = msg.columnId as string | undefined;
      const channelLabel = msg.channelLabel as string || 'Channel';
      const from = msg.from as string || 'unknown';
      const content = msg.content as string || '';

      // Try to find an existing channel column, or create a new one
      let col = channelColId ? getColumnById(channelColId) : columns.find(c => c.agentId === agentId && c.isChannelColumn);
      if (!col) {
        col = addColumn(agentId, true); // true = allow duplicate (separate from user chat)
        if (col) {
          col.isChannelColumn = true;
          // Override the column ID to match what the background assigned
          if (channelColId) {
            col.id = channelColId;
            col.columnEl.dataset.columnId = channelColId;
          }
        }
      }
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
      const col = resolveColumn();
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
      const col = resolveColumn();
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

      // Feature: Show sub-agent activity in master's chat column
      if (msgAgentId) {
        const subAgent = agents.find((a) => a.id === msgAgentId);
        if (subAgent && !subAgent.master) {
          const masterAgent = agents.find((a) => a.master);
          if (masterAgent && masterAgent.id !== msgAgentId) {
            const masterCol = getColumnForAgent(masterAgent.id);
            if (masterCol) {
              // Update or create inline status card for this sub-agent
              const cardId = `sub-agent-status-${msgAgentId}`;
              let card = masterCol.messagesEl.querySelector(`#${CSS.escape(cardId)}`) as HTMLDivElement | null;
              if (!card) {
                card = document.createElement('div');
                card.id = cardId;
                card.className = 'sub-agent-status-card';
                masterCol.messagesEl.appendChild(card);
              }
              const subName = escapeHtml(subAgent.name);
              let statusText = 'working...';
              if (progressType === 'tool-call') {
                const tn = msg.toolName as string || '';
                statusText = `using ${escapeHtml(tn)}`;
              } else if (progressType === 'thinking') {
                statusText = `thinking (Step ${iteration})`;
              } else if (progressType === 'text') {
                statusText = 'processing response';
              }
              card.innerHTML = `<svg class="sub-agent-status-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span class="sub-agent-status-name">${subName}</span> <span class="sub-agent-status-text">${statusText}</span>`;
              columnScrollToBottom(masterCol);
            }
          }
        }
      }
      break;
    }

    case 'agenticDone': {
      const col = resolveColumn();
      if (col) {
        col.isStreaming = false;
        col.typingEl.classList.remove('visible');
        col.sendBtn.disabled = false;
        // Finalize last step and keep it open so user can see the result
        finalizeStepSummary(col);
        if (col.currentStepDetails) {
          col.currentStepDetails.setAttribute('open', '');
        }
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

      // Refresh reactive data after agentic loop completes
      refreshTodayUsage();
      refreshArtifacts(); // Agent may have published artifacts
      refreshHooks(); // Agent may have created hooks
      refreshTasks(); // Agent may have created/updated tasks

      // Feature: Show sub-agent completion in master's chat column
      if (msgAgentId) {
        const subAgent = agents.find((a) => a.id === msgAgentId);
        if (subAgent && !subAgent.master) {
          const masterAgent = agents.find((a) => a.master);
          if (masterAgent && masterAgent.id !== msgAgentId) {
            const masterCol = getColumnForAgent(masterAgent.id);
            if (masterCol) {
              // Remove the "working" status card
              const cardId = `sub-agent-status-${msgAgentId}`;
              const card = masterCol.messagesEl.querySelector(`#${CSS.escape(cardId)}`);
              if (card) card.remove();

              // Add a completion notification
              const resultPreview = msg.result ? (msg.result as string).slice(0, 100) : '';
              const doneEl = document.createElement('div');
              doneEl.className = 'sub-agent-done-card';
              doneEl.innerHTML = `<svg class="sub-agent-status-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span class="sub-agent-status-name">${escapeHtml(subAgent.name)}</span> <span class="sub-agent-done-text">completed task${resultPreview ? ': ' + escapeHtml(resultPreview) : ''}</span>`;
              masterCol.messagesEl.appendChild(doneEl);
              columnScrollToBottom(masterCol);
            }
          }
        }
      }

      // If this was a "Run Now" scheduled task, update its run record
      if (pendingRunNowAlarmId) {
        const alarmId = pendingRunNowAlarmId;
        pendingRunNowAlarmId = null;
        sendMsg({ type: 'updateScheduledTaskRun', alarmId, result: ((msg.result as string) || '(no output)').slice(0, 200) })
          .then(() => refreshTasks())
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
      refreshSettings();
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
      // Clear is now handled directly in the clear button click handler
      // This message from the background just confirms storage was cleared
      break;
    }

    case 'hooksList': {
      const hooksList = msg.hooks as Hook[];
      hooksSignal.value = hooksList;
      const hooksViewEl = document.querySelector('chaos-hooks-view') as any;
      if (hooksViewEl) hooksViewEl.setHooks(hooksList);
      break;
    }

    case 'hookAdded':
    case 'hookUpdated':
    case 'hookRemoved':
      // Refresh hooks signal so all watching views update
      refreshHooks();
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
  agentsSignal.value = agentList;
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

  // On first load with no explicit hash view, check if dashboard should be default
  if (hasRestoredFromHash && activeView === 'chat' && !window.location.hash.includes('view=')) {
    sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' }).then((dashCheck) => {
      const hasPinned = dashCheck.artifacts.some(a => a.pinned);
      if (hasPinned) {
        activeView = 'dashboard';
        sidebarItems.forEach((b) => b.classList.toggle('active', b.dataset.view === 'dashboard'));
        updateViewVisibility();
        loadCurrentViewData();
      }
    }).catch(() => { /* stay on chat */ });
  }

  // Re-render sidebar agent list
  renderAgentTabs();

  // Update sidebar active state to match activeView
  sidebarItems.forEach((b) => {
    b.classList.toggle('active', b.dataset.view === activeView);
  });

  // Update view visibility carefully:
  // - Always update when no agent (show empty state)
  // - On first load (no view active): show the correct view and load data
  // - On subsequent agent list refreshes: DON'T touch the view (preserves user state)
  if (!activeAgentId) {
    updateViewVisibility();
  } else {
    const anyRealViewActive = document.querySelector('.view-panel.active:not(#view-no-agent)') !== null;
    if (!anyRealViewActive) {
      updateViewVisibility();
      loadCurrentViewData(); // Only load data on first render
    }
  }

  // Check if smart start should be shown (on page load, not already completed)
  if (!document.getElementById('smart-start-container')) {
    chrome.storage.local.get('chaos:smart-start-completed').then((stored) => {
      if (!stored['chaos:smart-start-completed']) {
        showSmartStart();
      }
    });
  }

  // Initialize columns if none exist
  if (activeAgentId && columns.length === 0) {
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
  // Build provider badge if agent has a custom model override
  // Show provider badge — custom overrides prominently, global default subtly
  let providerBadgeHtml = '';
  if (agent && (agent.provider || agent.model)) {
    const providerLabel = agent.provider
      ? (listProviders().find(p => p.id === agent.provider)?.displayName || agent.provider)
      : '';
    const badgeText = providerLabel || agent.model || '';
    if (badgeText) {
      providerBadgeHtml = `<span class="column-provider-badge">${escapeHtml(badgeText)}</span>`;
    }
  }

  headerEl.innerHTML = `
    <span class="column-drag-handle" title="Drag to reorder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>
    </span>
    <span class="column-agent-name">${escapeHtml(aName)}</span>
    ${providerBadgeHtml}
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

  // Delegate button — wraps input with delegation instruction
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
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Enter (Cmd+Enter on Mac) = delegate
        const text = column.inputEl.value.trim();
        if (text && !column.isStreaming) {
          column.inputEl.value = `Delegate this task to an appropriate sub-agent: ${text}`;
          sendColumnMessage(column);
        }
      } else {
        // Enter = normal send
        sendColumnMessage(column);
      }
    }
  });

  // Show delegation icon on send button when Ctrl/Cmd is held
  const sendIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  const delegateIcon = '<svg width="18" height="16" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v-2a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v2"/><circle cx="7" cy="7" r="3"/><line x1="18" y1="4" x2="26" y2="12"/><polygon points="26 4 22 18 18 12 12 10 26 4"/></svg>';
  textareaEl.addEventListener('keydown', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') {
      sendBtn.title = 'Delegate to sub-agent (Ctrl+Enter)';
      sendBtn.innerHTML = delegateIcon;
      sendBtn.style.color = 'var(--accent-text, #58a6ff)';
    }
  });
  textareaEl.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') {
      sendBtn.title = 'Send (Enter)';
      sendBtn.innerHTML = sendIcon;
      sendBtn.style.color = '';
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
    // Clear only THIS column's conversation, not all columns for this agent
    column.conversationHistory = [];
    column.messagesEl.innerHTML = '';
    addChatSystemMessageToColumn(column, 'Conversation cleared.');
    sendPortMessage({ type: 'clearConversation', agentId: column.agentId });
  });

  closeBtn.addEventListener('click', () => {
    removeColumn(colId);
  });

  micBtn.addEventListener('click', () => {
    focusedColumnId = colId;
    toggleVoiceInput();
  });

  // ── Drag-to-reorder ──
  const dragHandle = headerEl.querySelector('.column-drag-handle') as HTMLElement;
  dragHandle.setAttribute('draggable', 'true');

  dragHandle.addEventListener('dragstart', (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colId);
    // Use the whole column as the drag image
    e.dataTransfer.setDragImage(columnEl, 50, 20);
    requestAnimationFrame(() => columnEl.classList.add('column-dragging'));
  });

  columnEl.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    // Only show drop target if this isn't the dragged column
    const draggedId = columns.find(c => c.columnEl.classList.contains('column-dragging'))?.id;
    if (draggedId && draggedId !== colId) {
      columnEl.classList.add('column-drop-target');
    }
  });

  columnEl.addEventListener('dragleave', () => {
    columnEl.classList.remove('column-drop-target');
  });

  columnEl.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    columnEl.classList.remove('column-drop-target');
    if (!e.dataTransfer) return;
    const draggedColId = e.dataTransfer.getData('text/plain');
    if (!draggedColId || draggedColId === colId) return;

    const fromIdx = columns.findIndex(c => c.id === draggedColId);
    const toIdx = columns.findIndex(c => c.id === colId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Reorder the columns array
    const [moved] = columns.splice(fromIdx, 1);
    columns.splice(toIdx, 0, moved);

    // Reorder DOM: insert all columns before the [+] button
    const addBtnEl = columnsContainer.querySelector('.columns-add-btn');
    for (const col of columns) {
      columnsContainer.insertBefore(col.columnEl, addBtnEl);
    }

    saveColumnConfig();
  });

  dragHandle.addEventListener('dragend', () => {
    columnEl.classList.remove('column-dragging');
    // Clean up any lingering drop targets
    for (const col of columns) {
      col.columnEl.classList.remove('column-drop-target');
    }
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

  // Stop any active agent loop for this column.  isStreaming may be stale if
  // an error path didn't reset it, but sending a redundant stop is harmless —
  // the background will simply find no matching controller and ignore it.
  if (col.isStreaming) {
    sendPortMessage({ type: 'stopAgenticLoop', agentId: col.agentId, columnId: col.id });
    col.isStreaming = false;
  }

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

  // Columns always stay at fixed width (TweetDeck style) — never expand to fill
  columnsContainer.classList.remove('fit-columns');
}

function showColumnAddPicker(e: MouseEvent): void {
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

  // Build conversation history for multi-turn context
  const history = col.conversationHistory
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .map(e => ({ role: e.role, content: e.content }));

  const chatMsg: Record<string, unknown> = {
    type: 'chat',
    agentId: col.agentId,
    message: text,
    columnId: col.id,
    history,
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
  type: 'tab' | 'bookmark' | 'history' | 'agent' | 'artifact';
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

const MENTION_CATEGORIES = ['tab', 'bookmark', 'history', 'agent', 'artifact'] as const;
type MentionCategory = typeof MENTION_CATEGORIES[number];

const MENTION_ICONS: Record<MentionCategory, string> = {
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  artifact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
};

const MENTION_LABELS: Record<MentionCategory, string> = {
  tab: 'Tabs',
  bookmark: 'Bookmarks',
  history: 'History',
  agent: 'Agents',
  artifact: 'Artifacts',
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
    case 'artifact': {
      try {
        const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
        for (const a of (result.artifacts || [])) {
          const title = a.title || a.path.split('/').pop() || a.path;
          const subtitle = a.description || a.path;
          if (query && !title.toLowerCase().includes(query) && !subtitle.toLowerCase().includes(query)) continue;
          items.push({ type: 'artifact', title, subtitle, value: `@artifact[${title}](${a.path})`, id: a.path });
        }
      } catch { /* artifacts unavailable */ }
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


// ══════════════════════════════════════════
// ── Create Agent
// ══════════════════════════════════════════

const createAgentModal = document.getElementById('create-agent-modal')!;
const createCancelBtn = document.getElementById('btn-create-cancel')!;
const createConfirmBtn = document.getElementById('btn-create-confirm')!;

function showCreateAgentModal(): void {
  (document.getElementById('create-agent-name') as HTMLInputElement).value = '';
  (document.getElementById('create-agent-role') as HTMLSelectElement).value = 'neutral';
  (document.getElementById('create-agent-visibility') as HTMLSelectElement).value = 'visible';
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
// ── FileSystem Watch Handles (IndexedDB) ──

const FS_WATCH_DB = 'chaos-fs-watch';
const FS_WATCH_STORE = 'handles';

function openFsWatchDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_WATCH_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FS_WATCH_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeFsWatchHandle(name: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsWatchDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_WATCH_STORE, 'readwrite');
    tx.objectStore(FS_WATCH_STORE).put(handle, name);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadFsWatchHandles(): Promise<Map<string, FileSystemDirectoryHandle>> {
  const handles = new Map<string, FileSystemDirectoryHandle>();
  try {
    const db = await openFsWatchDb();
    return new Promise((resolve) => {
      const tx = db.transaction(FS_WATCH_STORE, 'readonly');
      const store = tx.objectStore(FS_WATCH_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          handles.set(cursor.key as string, cursor.value);
          cursor.continue();
        } else {
          db.close();
          resolve(handles);
        }
      };
      req.onerror = () => { db.close(); resolve(handles); };
    });
  } catch {
    return handles;
  }
}

function startFsObservation(name: string, handle: FileSystemDirectoryHandle): void {
  if (typeof (globalThis as any).FileSystemObserver === 'undefined') {
    console.warn('[fs-watch] FileSystemObserver not available in this browser');
    return;
  }
  try {
    const observer = new (globalThis as any).FileSystemObserver(
      (records: Array<{ type: string; changedHandle?: { name: string } }>) => {
        for (const record of records) {
          const path = record.changedHandle?.name || name;
          console.log(`[fs-watch] Change detected: ${record.type} in ${path}`);
          chrome.runtime.sendMessage({
            type: 'filesystemChanged',
            changeType: record.type,
            path,
            directory: name,
          });
        }
      },
    );
    observer.observe(handle, { recursive: true });
    console.log(`[fs-watch] Observing directory: ${name}`);
  } catch (err) {
    console.error('[fs-watch] Failed to start observation:', err);
  }
}

// On startup, restore file system observations from IndexedDB
loadFsWatchHandles().then(async (handles) => {
  for (const [name, handle] of handles) {
    // Verify permission is still granted
    try {
      const perm = await (handle as any).queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        startFsObservation(name, handle);
      } else {
        console.log(`[fs-watch] Permission not granted for ${name}, skipping`);
      }
    } catch {
      console.log(`[fs-watch] Could not check permission for ${name}`);
    }
  }
}).catch((err) => console.warn('[fs-watch] Failed to restore handles:', err));

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

// ══════════════════════════════════════════
// ── Smart Start — Context-aware first run
// ══════════════════════════════════════════

async function showSmartStart(): Promise<void> {
  // Check if already completed
  const stored = await chrome.storage.local.get('chaos:smart-start-completed');
  if (stored['chaos:smart-start-completed']) {
    console.log('[smart-start] Already completed, skipping');
    return;
  }

  const viewChat = document.getElementById('view-chat');
  if (!viewChat) return;

  // Create the container
  const container = document.createElement('div');
  container.className = 'smart-start-container';
  container.id = 'smart-start-container';

  // Show loading state
  container.innerHTML = `
    <div class="smart-start-inner">
      <div class="smart-start-header">
        <h2>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          Welcome to CHAOS
        </h2>
      </div>
      <div class="smart-start-loading">
        <div class="spinner"></div>
        <p>Analyzing your browsing context...</p>
        <p class="smart-start-privacy">This stays between you and your AI provider</p>
      </div>
    </div>
  `;

  viewChat.appendChild(container);

  try {
    // Gather browsing context
    console.log('[smart-start] Gathering browsing context...');
    const context = await sendMsg<{
      historyUrls: Array<{ url: string; title: string; visitTime: number }>;
      bookmarks: Array<{ url: string; title: string; dateAdded: number }>;
      openTabs: Array<{ url: string; title: string }>;
      readingList: Array<{ url: string; title: string }>;
      permissions: string[];
    }>({ type: 'gatherBrowsingContext' });

    console.log('[smart-start] Context gathered, analyzing...');

    // Analyze context
    const suggestions = await sendMsg<{
      summary: string;
      actions: Array<{ title: string; description: string; prompt: string }>;
      hookSuggestions: Array<{ description: string; trigger: HookTrigger; prompt: string; reason: string }>;
    }>({ type: 'analyzeForSmartStart', context });

    console.log('[smart-start] Suggestions received:', suggestions.actions?.length, 'actions');

    // Render the results
    renderSmartStartContent(container, suggestions);
  } catch (err) {
    console.error('[smart-start] Failed:', err);
    // Show fallback content
    renderSmartStartContent(container, {
      summary: 'Welcome! I can help you navigate the web more efficiently. Here are some things to try.',
      actions: [
        { title: 'Summarize this page', description: 'Read and summarize the content of your current tab', prompt: 'Summarize the current page I\'m viewing. Give me the key points and takeaways.' },
        { title: 'Organize my tabs', description: 'Group your open tabs into logical categories', prompt: 'Look at all my open tabs and suggest how to organize them into groups. Then help me group them.' },
        { title: 'What\'s interesting?', description: 'Find interesting patterns in your open tabs', prompt: 'Look at my open tabs and tell me what\'s interesting. What themes do you see? What should I pay attention to?' },
      ],
      hookSuggestions: [
        { description: 'Auto-summarize bookmarked pages', trigger: { type: 'bookmark-created' as const }, prompt: 'A new bookmark was just created. Read the bookmarked page and write a brief summary.', reason: 'Get automatic summaries of pages you bookmark.' },
        { description: 'Daily review', trigger: { type: 'browser-startup' as const }, prompt: 'Good morning! Do a quick review of my recent activity and suggest things to work on.', reason: 'Start each day with a quick briefing.' },
      ],
    });
  }
}

function renderSmartStartContent(
  container: HTMLElement,
  suggestions: {
    summary: string;
    actions: Array<{ title: string; description: string; prompt: string }>;
    hookSuggestions: Array<{ description: string; trigger: HookTrigger; prompt: string; reason: string }>;
  },
): void {
  const inner = container.querySelector('.smart-start-inner') || container;

  // Build action cards HTML
  let actionsHtml = '';
  for (const action of suggestions.actions) {
    actionsHtml += `
      <div class="smart-start-card" data-prompt="${escapeHtml(action.prompt)}">
        <p class="smart-start-card-title">${escapeHtml(action.title)}</p>
        <p class="smart-start-card-desc">${escapeHtml(action.description)}</p>
      </div>
    `;
  }

  // Build hook suggestions HTML
  let hooksHtml = '';
  for (let i = 0; i < suggestions.hookSuggestions.length; i++) {
    const hook = suggestions.hookSuggestions[i];
    hooksHtml += `
      <div class="smart-start-hook" data-hook-index="${i}">
        <div class="smart-start-hook-info">
          <p class="smart-start-hook-desc">${escapeHtml(hook.description)}</p>
          <p class="smart-start-hook-reason">${escapeHtml(hook.reason)}</p>
        </div>
        <div class="smart-start-hook-actions">
          <button class="btn btn-accent smart-start-hook-enable" data-hook-index="${i}">Enable</button>
          <button class="btn btn-ghost smart-start-hook-skip" data-hook-index="${i}">Skip</button>
        </div>
      </div>
    `;
  }

  inner.innerHTML = `
    <div class="smart-start-header">
      <h2>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        Welcome to CHAOS
      </h2>
      <p class="smart-start-summary">${escapeHtml(suggestions.summary)}</p>
    </div>
    <h3 class="smart-start-section-title">Suggested Actions</h3>
    <div class="smart-start-actions">
      ${actionsHtml}
    </div>
    ${suggestions.hookSuggestions.length > 0 ? `
      <h3 class="smart-start-section-title">Suggested Hooks</h3>
      <div class="smart-start-hooks">
        ${hooksHtml}
      </div>
    ` : ''}
    <div class="smart-start-footer">
      <button class="btn btn-ghost" id="smart-start-skip">Skip and start chatting</button>
      <p class="smart-start-privacy">This stays between you and your AI provider</p>
    </div>
  `;

  // Track interactions to update skip button text
  const skipBtnEl = inner.querySelector('#smart-start-skip') as HTMLButtonElement | null;
  function markInteracted() {
    if (skipBtnEl && skipBtnEl.textContent !== 'Continue') {
      skipBtnEl.textContent = 'Continue';
      skipBtnEl.classList.remove('btn-ghost');
      skipBtnEl.classList.add('btn-primary');
    }
  }

  // Wire up action card clicks
  const cards = inner.querySelectorAll('.smart-start-card');
  for (const card of cards) {
    card.addEventListener('click', async () => {
      const prompt = (card as HTMLElement).dataset.prompt;
      if (!prompt) return;

      // Mark completed and dismiss
      await chrome.storage.local.set({ 'chaos:smart-start-completed': true });
      container.remove();

      // Send the prompt to the agent
      const masterAgent = agents.find((a) => a.master);
      const targetAgent = masterAgent || agents[0];
      if (targetAgent) {
        sendPortMessage({
          type: 'agenticChat',
          agentId: targetAgent.id,
          message: prompt,
        });
      }
    });
  }

  // Wire up hook enable buttons
  const enableBtns = inner.querySelectorAll('.smart-start-hook-enable');
  for (const btn of enableBtns) {
    btn.addEventListener('click', async () => {
      const index = parseInt((btn as HTMLElement).dataset.hookIndex || '0', 10);
      const hookSuggestion = suggestions.hookSuggestions[index];
      if (!hookSuggestion) return;

      // Find the master agent to attach the hook to
      const masterAgent = agents.find((a) => a.master);
      const targetAgent = masterAgent || agents[0];
      if (!targetAgent) return;

      const hook: Hook = {
        id: `hook-ss-${Date.now()}-${index}`,
        agentId: targetAgent.id,
        description: hookSuggestion.description,
        trigger: hookSuggestion.trigger,
        prompt: hookSuggestion.prompt,
        enabled: true,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
      };

      sendPortMessage({ type: 'addHook', hook });
      // Refresh hooks signal after adding
      setTimeout(() => refreshHooks(), 100);

      // Update button to show enabled
      (btn as HTMLButtonElement).textContent = 'Enabled!';
      markInteracted();
      (btn as HTMLButtonElement).disabled = true;
      (btn as HTMLButtonElement).classList.remove('btn-accent');
      (btn as HTMLButtonElement).classList.add('btn-ghost');

      // Hide the skip button for this hook
      const hookEl = (btn as HTMLElement).closest('.smart-start-hook');
      const skipBtn = hookEl?.querySelector('.smart-start-hook-skip') as HTMLButtonElement | null;
      if (skipBtn) skipBtn.style.display = 'none';

      console.log('[smart-start] Hook enabled:', hookSuggestion.description);
    });
  }

  // Wire up hook skip buttons
  const skipBtns = inner.querySelectorAll('.smart-start-hook-skip');
  for (const btn of skipBtns) {
    btn.addEventListener('click', () => {
      const hookEl = (btn as HTMLElement).closest('.smart-start-hook');
      if (hookEl) hookEl.remove();
    });
  }

  // Wire up skip button
  const skipBtn = inner.querySelector('#smart-start-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      await chrome.storage.local.set({ 'chaos:smart-start-completed': true });
      container.remove();
    });
  }
}

// ══════════════════════════════════════════
// ── Initial load
// ══════════════════════════════════════════

async function init(): Promise<void> {
  // Connect the port for chat streaming
  port = connectPort();

  // Check if onboarding is needed
  try {
    const [completedResult, needsResult] = await Promise.all([
      chrome.storage.local.get('chaos:onboarding-completed'),
      chrome.storage.local.get('chaos:needs-onboarding'),
    ]);
    const completed = completedResult['chaos:onboarding-completed'];
    const needsOnboarding = needsResult['chaos:needs-onboarding'];

    // Show onboarding if: explicitly flagged by onInstalled, OR no API keys and not completed
    let shouldOnboard = !completed && needsOnboarding;
    if (!completed && !shouldOnboard) {
      try {
        const keys = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
        const hasAnyKey = Object.values(keys.keys).some(k => k && k.length > 0);
        shouldOnboard = !hasAnyKey;
      } catch {
        // Service worker may not be ready — skip onboarding check
      }
    }

    if (shouldOnboard) {
        const result = await showOnboarding(sendMsg);
        if (result) {
          // Onboarding completed — refresh settings signal and load agents
          refreshSettings();
          sendPortMessage({ type: 'listAgents' });
          // Wait briefly for agents to load, then show smart start
          setTimeout(() => {
            showSmartStart();
          }, 2000);
          return;
        }
        // User somehow closed without completing — continue to normal load
      }
  } catch (err) {
    console.warn('[app] Onboarding check failed, continuing normally:', err);
  }

  sendPortMessage({ type: 'listAgents' });

  // Load initial data into signals
  refreshArtifacts();
  refreshHooks();
  refreshUsage();
  refreshTodayUsage();
  refreshTasks();
  refreshMessages();
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
