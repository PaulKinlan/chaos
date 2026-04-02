/**
 * Dashboard UI (app.html)
 *
 * Full-tab new tab page and "operating system view" showing:
 * - Chat (primary, default tab) with full-width conversation interface
 * - Agents, Tasks, Messages, Artifacts dashboard tabs
 * - Files: OPFS file explorer for agent transparency
 * - Settings
 *
 * Chat uses a long-lived port (like sidepanel.ts) for streaming.
 * Dashboard tabs use chrome.runtime.sendMessage (one-shot request/response).
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentMeta, AgentMessage, Task, ArtifactMeta, ApiKeys } from './storage/types.js';
import { getAllPermissions, setPermission, DEFAULT_PERMISSIONS, type PermissionLevel } from './tools/permissions.js';
import { needsSandbox, renderInSandbox } from './ui/sandbox-renderer.js';
import { hasPermission, hasHostPermissions } from './permissions.js';

// ── Configure marked ──

marked.setOptions({
  gfm: true,
  breaks: true,
});

// ── State ──

let agents: AgentMeta[] = [];
let tasks: Task[] = [];
let messages: AgentMessage[] = [];
let artifacts: ArtifactMeta[] = [];
let expandedAgentId: string | null = null;

// Chat state
let port: chrome.runtime.Port | null = null;
let chatActiveAgentId: string | null = null;
let isChatStreaming = false;
let chatPageContext: { title: string; url: string; content: string } | null = null;
let currentStreamEl: HTMLDivElement | null = null;
let currentStreamContent = '';
let reconnectAttempts = 0;
const MAX_RECONNECT_RETRIES = 3;

interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  pageContext?: { title: string; url: string };
}

let conversationHistory: ConversationEntry[] = [];

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

// ── One-shot messaging (for dashboard tabs) ──

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
// ── Tab navigation
// ══════════════════════════════════════════

const tabButtons = document.querySelectorAll<HTMLButtonElement>('.topbar-tab');
const tabPanels = document.querySelectorAll<HTMLDivElement>('.tab-panel');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab!;
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${tab}`)!.classList.add('active');

    // Load data when switching tabs
    switch (tab) {
      case 'chat':
        // Chat is always connected via port
        break;
      case 'agents':
        loadAgents();
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
      case 'files':
        loadFilesTab();
        break;
      case 'settings':
        loadSettings();
        loadPermissions();
        break;
    }
  });
});

// ══════════════════════════════════════════
// ── Chat Tab (port-based streaming)
// ══════════════════════════════════════════

const chatAgentSelect = document.getElementById('chat-agent-select') as HTMLSelectElement;
const chatMessagesDiv = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatBtnSend = document.getElementById('chat-btn-send') as HTMLButtonElement;
const chatBtnReadPage = document.getElementById('chat-btn-read-page') as HTMLButtonElement;
const chatBtnClear = document.getElementById('chat-btn-clear') as HTMLButtonElement;
const chatBtnNewAgent = document.getElementById('chat-btn-new-agent') as HTMLButtonElement;
const chatBtnMic = document.getElementById('chat-btn-mic') as HTMLButtonElement;
const chatTyping = document.getElementById('chat-typing') as HTMLDivElement;
const chatPageContextBar = document.getElementById('chat-page-context') as HTMLDivElement;
const chatPageContextText = document.getElementById('chat-page-context-text') as HTMLSpanElement;
const chatBtnDismissContext = document.getElementById('chat-btn-dismiss-context') as HTMLSpanElement;

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: 'chaos-sidepanel' });

  p.onMessage.addListener((msg: Record<string, unknown>) => {
    handlePortMessage(msg);
  });

  p.onDisconnect.addListener(() => {
    port = null;
    if (reconnectAttempts < MAX_RECONNECT_RETRIES) {
      const delay = Math.pow(2, reconnectAttempts) * 1000;
      reconnectAttempts++;
      addChatSystemMessage(`Connection lost. Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT_RETRIES})`);
      setTimeout(() => {
        try {
          port = connectPort();
          reconnectAttempts = 0;
          addChatSystemMessage('Reconnected.');
          sendPortMessage({ type: 'listAgents' });
        } catch {
          // Will be handled by next disconnect
        }
      }, delay);
    } else {
      addChatSystemMessage('Could not reconnect. Please reload the page.');
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
  switch (msg.type) {
    case 'agentList':
      populateChatAgentSelect(msg.agents as AgentMeta[]);
      break;

    case 'agentCreated': {
      const agent = msg.agent as AgentMeta;
      addChatAgentOption(agent);
      chatAgentSelect.value = agent.id;
      chatActiveAgentId = agent.id;
      addChatSystemMessage(`Agent "${agent.name}" created.`);
      createAgentModal.classList.remove('visible');
      // Refresh the agents panel
      loadAgents();
      break;
    }

    case 'agentDeleted':
      sendPortMessage({ type: 'listAgents' });
      addChatSystemMessage('Agent deleted.');
      // Refresh the agents panel
      loadAgents();
      break;

    case 'chatStart':
      isChatStreaming = true;
      currentStreamContent = '';
      currentStreamEl = addChatAssistantMessage('');
      chatTyping.classList.add('visible');
      chatBtnSend.disabled = true;
      break;

    case 'chatChunk':
      if (currentStreamEl) {
        currentStreamContent += msg.chunk as string;
        renderChatMarkdown(currentStreamEl, currentStreamContent);
        chatScrollToBottom();
      }
      break;

    case 'chatEnd':
      isChatStreaming = false;
      chatTyping.classList.remove('visible');
      chatBtnSend.disabled = false;
      if (currentStreamEl && msg.fullResponse) {
        renderChatMarkdown(currentStreamEl, msg.fullResponse as string);
      }
      if (msg.fullResponse) {
        conversationHistory.push({
          role: 'assistant',
          content: msg.fullResponse as string,
          timestamp: new Date().toISOString(),
        });
        saveChatConversation();
      }
      currentStreamEl = null;
      currentStreamContent = '';
      chatScrollToBottom();
      break;

    case 'chatError':
      isChatStreaming = false;
      chatTyping.classList.remove('visible');
      chatBtnSend.disabled = false;
      if (currentStreamEl) {
        currentStreamEl.remove();
      }
      currentStreamEl = null;
      currentStreamContent = '';
      addChatErrorMessage(msg.error as string);
      break;

    case 'extractedContent':
      if (msg.content) {
        const content = msg.content as { title: string; url: string; content: string };
        chatPageContext = content;
        chatPageContextText.textContent = `Page loaded: ${content.title}`;
        chatPageContextBar.classList.add('visible');
        addChatSystemMessage(`Page content loaded: "${content.title}"`);
      } else {
        addChatSystemMessage(`Could not extract page content: ${msg.error || 'unknown error'}`);
      }
      break;

    case 'apiKeys':
      // handled by settings
      break;

    case 'apiKeysSaved':
      addChatSystemMessage('Settings saved.');
      break;

    case 'conversationLoaded': {
      const loadedMessages = msg.messages as ConversationEntry[];
      conversationHistory = loadedMessages;
      chatMessagesDiv.innerHTML = '';
      for (const entry of loadedMessages) {
        if (entry.role === 'user') {
          addChatUserMessage(entry.content);
        } else if (entry.role === 'assistant') {
          addChatAssistantMessage(entry.content);
        } else if (entry.role === 'system') {
          addChatSystemMessage(entry.content);
        }
      }
      break;
    }

    case 'conversationSaved':
      break;

    case 'conversationCleared':
      conversationHistory = [];
      chatMessagesDiv.innerHTML = '';
      addChatSystemMessage('Conversation cleared.');
      break;

    case 'error':
      addChatSystemMessage(`Error: ${msg.error}`);
      break;
  }
}

// ── Chat agent select ──

function populateChatAgentSelect(agentList: AgentMeta[]): void {
  // Also update the global agents array
  agents = agentList;
  populateAgentFilters();

  while (chatAgentSelect.options.length > 1) {
    chatAgentSelect.remove(1);
  }

  for (const agent of agentList) {
    addChatAgentOption(agent);
  }

  if (chatActiveAgentId) {
    chatAgentSelect.value = chatActiveAgentId;
  } else if (agentList.length > 0) {
    chatAgentSelect.value = agentList[0].id;
    chatActiveAgentId = agentList[0].id;
  }

  if (chatActiveAgentId) {
    sendPortMessage({ type: 'getConversation', agentId: chatActiveAgentId });
  }
}

function addChatAgentOption(agent: AgentMeta): void {
  const opt = document.createElement('option');
  opt.value = agent.id;
  opt.textContent = `${agent.name} (${agent.role})`;
  chatAgentSelect.appendChild(opt);
}

chatAgentSelect.addEventListener('change', () => {
  saveChatConversation();
  chatActiveAgentId = chatAgentSelect.value || null;
  chatMessagesDiv.innerHTML = '';
  conversationHistory = [];
  chatPageContext = null;
  chatPageContextBar.classList.remove('visible');
  if (chatActiveAgentId) {
    sendPortMessage({ type: 'getConversation', agentId: chatActiveAgentId });
  }
});

// ── Chat message rendering ──

function addChatUserMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message user';
  el.textContent = text;
  chatMessagesDiv.appendChild(el);
  chatScrollToBottom();
}

function addChatAssistantMessage(content: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'chat-message assistant';
  if (content) {
    renderChatMarkdown(el, content);
  }
  chatMessagesDiv.appendChild(el);
  chatScrollToBottom();
  return el;
}

function addChatSystemMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message system';
  el.textContent = text;
  chatMessagesDiv.appendChild(el);
  chatScrollToBottom();
}

function addChatErrorMessage(error: string): void {
  const el = document.createElement('div');
  el.className = 'chat-message error';
  el.textContent = `Error: ${error}`;
  chatMessagesDiv.appendChild(el);
  chatScrollToBottom();
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

function chatScrollToBottom(): void {
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// ── Chat send ──

function sendChatMessage(): void {
  const text = chatInput.value.trim();
  if (!text || isChatStreaming) return;

  if (!chatActiveAgentId) {
    addChatSystemMessage('Please select or create an agent first.');
    return;
  }

  addChatUserMessage(text);
  chatInput.value = '';
  chatAutoResize();

  const entry: ConversationEntry = {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  };

  const msg: Record<string, unknown> = {
    type: 'chat',
    agentId: chatActiveAgentId,
    message: text,
  };

  if (chatPageContext) {
    msg.pageContext = chatPageContext;
    entry.pageContext = { title: chatPageContext.title, url: chatPageContext.url };
    chatPageContext = null;
    chatPageContextBar.classList.remove('visible');
  }

  conversationHistory.push(entry);
  sendPortMessage(msg);
}

function saveChatConversation(): void {
  if (!chatActiveAgentId || conversationHistory.length === 0) return;
  sendPortMessage({
    type: 'saveConversation',
    agentId: chatActiveAgentId,
    messages: conversationHistory,
  });
}

chatBtnSend.addEventListener('click', sendChatMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

function chatAutoResize(): void {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
}

chatInput.addEventListener('input', chatAutoResize);

// ── Chat actions ──

chatBtnReadPage.addEventListener('click', async () => {
  const hasScripting = await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  if (!hasScripting) {
    const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) {
      addChatSystemMessage('Permission denied. Enable "Read page content" in Settings to use this feature.');
      return;
    }
  }
  sendPortMessage({ type: 'extractContent' });
});

chatBtnClear.addEventListener('click', () => {
  if (!chatActiveAgentId) return;
  sendPortMessage({ type: 'clearConversation', agentId: chatActiveAgentId });
});

chatBtnDismissContext.addEventListener('click', () => {
  chatPageContext = null;
  chatPageContextBar.classList.remove('visible');
});

chatBtnNewAgent.addEventListener('click', () => {
  (document.getElementById('create-agent-name') as HTMLInputElement).value = '';
  (document.getElementById('create-agent-role') as HTMLSelectElement).value = 'neutral';
  createAgentModal.classList.add('visible');
  (document.getElementById('create-agent-name') as HTMLInputElement).focus();
});

// ── Chat voice input ──

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any = null;
let isRecording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interim = transcript;
      }
    }
    const existingText = chatInput.value.substring(0, chatInput.value.length - (chatInput.dataset.lastInterim?.length || 0));
    chatInput.value = existingText + finalTranscript + interim;
    chatInput.dataset.lastInterim = interim;
    chatInput.scrollTop = chatInput.scrollHeight;
  };

  recognition.onend = () => {
    if (isRecording) {
      recognition.start();
    } else {
      chatBtnMic.classList.remove('recording');
      finalTranscript = '';
      delete chatInput.dataset.lastInterim;
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      addChatSystemMessage(`Speech recognition error: ${event.error}`);
    }
    isRecording = false;
    chatBtnMic.classList.remove('recording');
    finalTranscript = '';
    delete chatInput.dataset.lastInterim;
  };

  chatBtnMic.addEventListener('click', () => {
    if (isRecording) {
      isRecording = false;
      recognition.stop();
      chatBtnMic.classList.remove('recording');
    } else {
      isRecording = true;
      finalTranscript = '';
      chatInput.dataset.lastInterim = '';
      recognition.start();
      chatBtnMic.classList.add('recording');
    }
  });
} else {
  chatBtnMic.style.display = 'none';
}

// ══════════════════════════════════════════
// ── Agents Tab
// ══════════════════════════════════════════

async function loadAgents(): Promise<void> {
  showPanelLoading('panel-agents');
  try {
    const result = await sendMsg<{ agents: AgentMeta[] }>({ type: 'listAgents' });
    agents = result.agents;
    renderAgents();
  } catch (err) {
    showPanelError('panel-agents', `Failed to load agents: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('panel-agents');
  }
}

function renderAgents(): void {
  const grid = document.getElementById('agent-grid')!;
  const empty = document.getElementById('agents-empty')!;
  const detail = document.getElementById('agent-detail')!;

  if (agents.length === 0) {
    grid.innerHTML = '';
    detail.innerHTML = '';
    detail.classList.remove('active');
    empty.textContent = 'No agents yet \u2014 create one to get started.';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = agents
    .map(
      (a) => `
    <div class="agent-card" data-agent-id="${a.id}">
      <div class="agent-card-header">
        <span class="agent-card-name">${escapeHtml(a.name)}</span>
        <div class="agent-card-badges">
          <span class="badge ${roleBadgeClass(a.role)}">${escapeHtml(a.role)}</span>
          <span class="badge ${visBadgeClass(a.visibility)}">${escapeHtml(a.visibility)}</span>
        </div>
      </div>
      <div class="agent-card-meta">Created ${relativeTime(a.createdAt)}</div>
    </div>
  `,
    )
    .join('');

  grid.querySelectorAll<HTMLDivElement>('.agent-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.agentId!;
      if (expandedAgentId === id) {
        expandedAgentId = null;
        detail.classList.remove('active');
        detail.innerHTML = '';
      } else {
        expandedAgentId = id;
        loadAgentDetail(id);
      }
    });
  });
}

async function loadAgentDetail(agentId: string): Promise<void> {
  const detail = document.getElementById('agent-detail')!;
  detail.classList.add('active');
  detail.innerHTML = '<div class="agent-detail-inner"><p style="color:#64748b;">Loading...</p></div>';

  const result = await sendMsg<{
    claudeMd: string;
    journal: string[];
    bookmarks: string[];
    meta: AgentMeta;
  }>({ type: 'getAgentDetail', agentId });

  const meta = result.meta;
  const claudeMd = result.claudeMd || '(empty)';
  const journal = result.journal || [];
  const bookmarks = result.bookmarks || [];

  const journalHtml =
    journal.length > 0
      ? journal
          .map((entry) => {
            try {
              const parsed = JSON.parse(entry);
              return `<div class="journal-entry">
                <div class="journal-entry-time">${escapeHtml(formatTimeFull(parsed.timestamp || ''))}</div>
                <div class="journal-entry-text">${escapeHtml(parsed.summary || parsed.action || JSON.stringify(parsed))}</div>
              </div>`;
            } catch {
              return `<div class="journal-entry"><div class="journal-entry-text">${escapeHtml(entry)}</div></div>`;
            }
          })
          .join('')
      : '<p style="color:#64748b;font-size:13px;">No activity yet.</p>';

  const bookmarksHtml =
    bookmarks.length > 0
      ? bookmarks
          .map((b) => `<div class="bookmark-item">${escapeHtml(b)}</div>`)
          .join('')
      : '<p style="color:#64748b;font-size:13px;">No bookmarks.</p>';

  detail.innerHTML = `
    <div class="agent-detail-inner">
      <div class="agent-detail-header">
        <span class="agent-detail-title">${escapeHtml(meta.name)}</span>
        <div class="agent-detail-actions">
          <label style="font-size:12px;color:#94a3b8;margin-right:4px;">Visibility:</label>
          <select class="vis-select" id="vis-select-${meta.id}" data-agent-id="${meta.id}">
            <option value="private"${meta.visibility === 'private' ? ' selected' : ''}>Private</option>
            <option value="visible"${meta.visibility === 'visible' ? ' selected' : ''}>Visible</option>
            <option value="open"${meta.visibility === 'open' ? ' selected' : ''}>Open</option>
          </select>
          <button class="btn btn-danger btn-sm" data-delete-agent="${meta.id}">Delete</button>
        </div>
      </div>
      <div class="agent-detail-section">
        <h4>CLAUDE.md</h4>
        <div class="claude-md-content">${escapeHtml(claudeMd)}</div>
      </div>
      <div class="agent-detail-section">
        <h4>Recent Activity</h4>
        <div class="journal-entries">${journalHtml}</div>
      </div>
      <div class="agent-detail-section">
        <h4>Bookmarks</h4>
        <div class="bookmarks-list">${bookmarksHtml}</div>
      </div>
    </div>
  `;

  const visSelect = document.getElementById(`vis-select-${meta.id}`) as HTMLSelectElement;
  visSelect.addEventListener('change', async () => {
    await sendMsg({
      type: 'updateAgentVisibility',
      agentId: meta.id,
      visibility: visSelect.value,
    });
    await loadAgents();
    expandedAgentId = meta.id;
    await loadAgentDetail(meta.id);
  });

  const deleteBtn = detail.querySelector(`[data-delete-agent="${meta.id}"]`) as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    showConfirm(
      'Delete Agent',
      `Are you sure you want to delete "${meta.name}"? This cannot be undone.`,
      async () => {
        await sendMsg({ type: 'deleteAgent', agentId: meta.id });
        expandedAgentId = null;
        detail.classList.remove('active');
        detail.innerHTML = '';
        await loadAgents();
      },
    );
  });
}

// ── Create Agent ──

const createAgentModal = document.getElementById('create-agent-modal')!;
const createCancelBtn = document.getElementById('btn-create-cancel')!;
const createConfirmBtn = document.getElementById('btn-create-confirm')!;

document.getElementById('btn-create-agent')!.addEventListener('click', () => {
  (document.getElementById('create-agent-name') as HTMLInputElement).value = '';
  (document.getElementById('create-agent-role') as HTMLSelectElement).value = 'neutral';
  createAgentModal.classList.add('visible');
  (document.getElementById('create-agent-name') as HTMLInputElement).focus();
});

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

  // If we're on the chat tab, use port-based creation for instant feedback
  if (port) {
    sendPortMessage({ type: 'createAgent', name, role, visibility });
  } else {
    try {
      await sendMsg({ type: 'createAgent', name, role, visibility });
      await loadAgents();
    } catch (err) {
      showPanelError('panel-agents', `Failed to create agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

createAgentModal.addEventListener('click', (e) => {
  if (e.target === createAgentModal) createAgentModal.classList.remove('visible');
});

// ══════════════════════════════════════════
// ── Tasks Tab
// ══════════════════════════════════════════

async function loadTasks(): Promise<void> {
  showPanelLoading('panel-tasks');
  try {
    const result = await sendMsg<{ tasks: Task[] }>({ type: 'getTaskState' });
    tasks = result.tasks;
    renderTasks();
  } catch (err) {
    showPanelError('panel-tasks', `Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('panel-tasks');
  }
}

function renderTasks(): void {
  const tbody = document.getElementById('tasks-tbody')!;
  const empty = document.getElementById('tasks-empty')!;
  const table = document.getElementById('tasks-table')!;

  const filterAgent = (document.getElementById('tasks-filter-agent') as HTMLSelectElement).value;
  const filterStatus = (document.getElementById('tasks-filter-status') as HTMLSelectElement).value;

  let filtered = tasks;
  if (filterAgent) {
    filtered = filtered.filter((t) => t.owner === filterAgent);
  }
  if (filterStatus) {
    filtered = filtered.filter((t) => t.status === filterStatus);
  }

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.textContent = tasks.length === 0 ? 'No tasks yet.' : 'No tasks match the current filters.';
    empty.style.display = '';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = filtered
    .map(
      (t) => `
    <tr class="clickable" data-task-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.subject)}</td>
      <td>${t.owner ? escapeHtml(agentName(t.owner)) : '<span style="color:#64748b">Unassigned</span>'}</td>
      <td><span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(t.status.replace('_', ' '))}</span></td>
      <td>${t.blockedBy && t.blockedBy.length > 0 ? t.blockedBy.map((id) => escapeHtml(taskSubject(id))).join(', ') : '<span style="color:#64748b">None</span>'}</td>
      <td class="col-time">${formatTime(t.createdAt)}</td>
      <td class="col-time">${formatTime(t.updatedAt)}</td>
    </tr>
  `,
    )
    .join('');

  tbody.querySelectorAll<HTMLTableRowElement>('tr.clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const taskId = row.dataset.taskId!;
      showTaskDetail(taskId);
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

document.getElementById('tasks-filter-agent')!.addEventListener('change', renderTasks);
document.getElementById('tasks-filter-status')!.addEventListener('change', renderTasks);

document.getElementById('task-detail-close')!.addEventListener('click', () => {
  document.getElementById('task-detail-modal')!.classList.remove('visible');
});

document.getElementById('task-detail-modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('task-detail-modal')) {
    document.getElementById('task-detail-modal')!.classList.remove('visible');
  }
});

// ══════════════════════════════════════════
// ── Messages Tab
// ══════════════════════════════════════════

async function loadMessages(): Promise<void> {
  showPanelLoading('panel-messages');
  try {
    const result = await sendMsg<{ messages: AgentMessage[] }>({ type: 'getMessages' });
    messages = result.messages;
    renderMessages();
  } catch (err) {
    showPanelError('panel-messages', `Failed to load messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('panel-messages');
  }
}

function renderMessages(): void {
  const list = document.getElementById('message-list')!;
  const empty = document.getElementById('messages-empty')!;

  const filterAgent = (document.getElementById('messages-filter-agent') as HTMLSelectElement).value;
  const searchText = (document.getElementById('messages-search') as HTMLInputElement).value
    .toLowerCase()
    .trim();

  let filtered = messages;
  if (filterAgent) {
    filtered = filtered.filter((m) => m.from === filterAgent || m.to === filterAgent);
  }
  if (searchText) {
    filtered = filtered.filter((m) => m.body.toLowerCase().includes(searchText));
  }

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.textContent = messages.length === 0 ? 'No messages yet.' : 'No messages match the current filters.';
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

document.getElementById('messages-filter-agent')!.addEventListener('change', renderMessages);
document.getElementById('messages-search')!.addEventListener('input', renderMessages);

// ══════════════════════════════════════════
// ── Artifacts Tab
// ══════════════════════════════════════════

async function loadArtifacts(): Promise<void> {
  showPanelLoading('panel-artifacts');
  try {
    const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
    artifacts = result.artifacts;
    renderArtifacts();
  } catch (err) {
    showPanelError('panel-artifacts', `Failed to load artifacts: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('panel-artifacts');
  }
}

function renderArtifacts(): void {
  const grid = document.getElementById('artifact-grid')!;
  const empty = document.getElementById('artifacts-empty')!;

  const filterAgent = (document.getElementById('artifacts-filter-agent') as HTMLSelectElement).value;

  let filtered = artifacts;
  if (filterAgent) {
    filtered = filtered.filter((a) => a.agentId === filterAgent);
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.textContent = artifacts.length === 0 ? 'No artifacts yet.' : 'No artifacts match the current filter.';
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
        <span>${escapeHtml(agentName(a.agentId))}</span>
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
      <div class="task-detail-value" style="font-family:monospace;font-size:12px;">${escapeHtml(artifact.path)}</div>
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

document.getElementById('artifact-detail-close')!.addEventListener('click', () => {
  document.getElementById('artifact-detail-modal')!.classList.remove('visible');
});

document.getElementById('artifact-detail-modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('artifact-detail-modal')) {
    document.getElementById('artifact-detail-modal')!.classList.remove('visible');
  }
});

document.getElementById('artifacts-filter-agent')!.addEventListener('change', renderArtifacts);

// ══════════════════════════════════════════
// ── Files Tab (OPFS File Explorer)
// ══════════════════════════════════════════

interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

const filesAgentSelect = document.getElementById('files-agent-select') as HTMLSelectElement;
const filesTree = document.getElementById('files-tree') as HTMLDivElement;
const filesViewerFilename = document.getElementById('files-viewer-filename') as HTMLSpanElement;
const filesViewerContent = document.getElementById('files-viewer-content') as HTMLDivElement;
const filesBtnDownload = document.getElementById('files-btn-download') as HTMLButtonElement;

let filesSelectedPath: string | null = null;
let filesSelectedContent: string | null = null;

function loadFilesTab(): void {
  // Populate agent selector
  while (filesAgentSelect.options.length > 1) {
    filesAgentSelect.remove(1);
  }
  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = `${agent.name} (${agent.role})`;
    filesAgentSelect.appendChild(opt);
  }
}

filesAgentSelect.addEventListener('change', async () => {
  const agentId = filesAgentSelect.value;
  if (!agentId) {
    filesTree.innerHTML = '<div class="empty-state" style="padding:24px;"><p>Select an agent to browse its files.</p></div>';
    filesViewerFilename.textContent = 'No file selected';
    filesViewerContent.innerHTML = '<div class="files-viewer-empty">Select a file to view its contents.</div>';
    filesBtnDownload.style.display = 'none';
    return;
  }

  filesTree.innerHTML = '<p style="color:#64748b;padding:12px;">Loading...</p>';

  try {
    const result = await sendMsg<{ files: FileEntry[] }>({ type: 'listAgentFiles', agentId });
    renderFileTree(result.files, agentId);
  } catch (err) {
    filesTree.innerHTML = `<p style="color:#f87171;padding:12px;">Error: ${err instanceof Error ? err.message : String(err)}</p>`;
  }
});

function renderFileTree(entries: FileEntry[], agentId: string, depth = 0): void {
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

    const icon = entry.kind === 'directory' ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    const sizeStr = entry.size !== undefined ? formatFileSize(entry.size) : '';

    item.innerHTML = `<span class="icon">${icon}</span><span class="name">${escapeHtml(entry.name)}</span>${sizeStr ? `<span class="size">${sizeStr}</span>` : ''}`;

    if (entry.kind === 'file') {
      item.addEventListener('click', () => {
        // Deselect previous
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
  filesViewerContent.innerHTML = '<p style="color:#64748b;">Loading...</p>';
  filesBtnDownload.style.display = 'none';

  try {
    const result = await sendMsg<{ content: string }>({ type: 'readAgentFile', agentId, path: filePath });
    filesSelectedPath = filePath;
    filesSelectedContent = result.content;
    filesBtnDownload.style.display = '';

    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (ext === 'md') {
      // Render markdown
      filesViewerContent.className = 'files-viewer-content markdown-view';
      const rawHtml = marked.parse(result.content) as string;
      filesViewerContent.innerHTML = DOMPurify.sanitize(rawHtml);
    } else if (ext === 'jsonl') {
      // Render JSONL with syntax highlighting
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
      // Raw text
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
// ── Settings Tab
// ══════════════════════════════════════════

async function loadSettings(): Promise<void> {
  showPanelLoading('panel-settings');
  try {
    const result = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
    const keys = result.keys;

    (document.getElementById('settings-key-anthropic') as HTMLInputElement).value =
      keys.anthropic || '';
    (document.getElementById('settings-key-google') as HTMLInputElement).value = keys.google || '';
    (document.getElementById('settings-key-openai') as HTMLInputElement).value = keys.openai || '';
    (document.getElementById('settings-key-openrouter') as HTMLInputElement).value =
      keys.openrouter || '';
  } catch (err) {
    showPanelError('panel-settings', `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hidePanelLoading('panel-settings');
  }
}

document.getElementById('btn-save-keys')!.addEventListener('click', async () => {
  const keys: ApiKeys = {
    anthropic:
      (document.getElementById('settings-key-anthropic') as HTMLInputElement).value.trim() ||
      undefined,
    google:
      (document.getElementById('settings-key-google') as HTMLInputElement).value.trim() ||
      undefined,
    openai:
      (document.getElementById('settings-key-openai') as HTMLInputElement).value.trim() ||
      undefined,
    openrouter:
      (document.getElementById('settings-key-openrouter') as HTMLInputElement).value.trim() ||
      undefined,
  };
  await sendMsg({ type: 'setApiKeys', keys });
  alert('API keys saved.');
});

document.getElementById('btn-save-prefs')!.addEventListener('click', () => {
  alert('Preferences saved.');
});


// ── Tool Permissions ──

async function loadPermissions(): Promise<void> {
  const perms = await getAllPermissions();
  const grid = document.getElementById('tool-permissions-grid')!;

  const toolNames = Object.keys(DEFAULT_PERMISSIONS).sort();

  grid.innerHTML = toolNames
    .map((name) => {
      const level = perms[name] ?? 'ask';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155;">
        <span style="font-size:13px;font-family:monospace;color:#cbd5e1;">${escapeHtml(name)}</span>
        <select class="perm-select" data-tool="${escapeHtml(name)}" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px 8px;font-size:12px;outline:none;">
          <option value="always"${level === 'always' ? ' selected' : ''}>Always</option>
          <option value="ask"${level === 'ask' ? ' selected' : ''}>Ask</option>
          <option value="never"${level === 'never' ? ' selected' : ''}>Never</option>
        </select>
      </div>`;
    })
    .join('');
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
// ── Agent filter dropdowns (shared across tabs)
// ══════════════════════════════════════════

function populateAgentFilters(): void {
  const selects = [
    document.getElementById('tasks-filter-agent') as HTMLSelectElement,
    document.getElementById('messages-filter-agent') as HTMLSelectElement,
    document.getElementById('artifacts-filter-agent') as HTMLSelectElement,
  ];

  for (const select of selects) {
    while (select.options.length > 1) {
      select.remove(1);
    }
    for (const agent of agents) {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = `${agent.name} (${agent.role})`;
      select.appendChild(opt);
    }
  }
}

// ══════════════════════════════════════════
// ── Initial load
// ══════════════════════════════════════════

async function init(): Promise<void> {
  // Connect the port for chat streaming
  port = connectPort();
  sendPortMessage({ type: 'listAgents' });
}

init();
