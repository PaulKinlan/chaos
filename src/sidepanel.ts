/**
 * Side Panel UI
 *
 * Chat interface for interacting with CHAOS agents.
 * Communicates with the background service worker via a long-lived port.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentMeta, ApiKeys, Settings } from './storage/types.js';
import { needsSandbox, renderInSandbox } from './ui/sandbox-renderer.js';
import { getAllPermissions, setPermission, DEFAULT_PERMISSIONS, type PermissionLevel } from './tools/permissions.js';
import { hasPermission, hasHostPermissions } from './permissions.js';

// ── Configure marked ──

marked.setOptions({
  gfm: true,
  breaks: true,
});

// ── DOM elements ──

const agentSelect = document.getElementById('agent-select') as HTMLSelectElement;
const messagesDiv = document.getElementById('messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const btnReadPage = document.getElementById('btn-read-page') as HTMLButtonElement;
const btnClearChat = document.getElementById('btn-clear-chat') as HTMLButtonElement;
const btnNewAgent = document.getElementById('btn-new-agent') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnMic = document.getElementById('btn-mic') as HTMLButtonElement;
const typingIndicator = document.getElementById('typing-indicator') as HTMLDivElement;
const setupPrompt = document.getElementById('setup-prompt') as HTMLDivElement;
const pageContextBar = document.getElementById('page-context') as HTMLDivElement;
const pageContextText = document.getElementById('page-context-text') as HTMLSpanElement;
const btnDismissContext = document.getElementById('btn-dismiss-context') as HTMLSpanElement;

// Settings modal
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const btnSettingsCancel = document.getElementById('btn-settings-cancel') as HTMLButtonElement;
const btnSettingsSave = document.getElementById('btn-settings-save') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const keyAnthropicInput = document.getElementById('key-anthropic') as HTMLInputElement;
const keyGoogleInput = document.getElementById('key-google') as HTMLInputElement;
const keyOpenaiInput = document.getElementById('key-openai') as HTMLInputElement;
const keyOpenrouterInput = document.getElementById('key-openrouter') as HTMLInputElement;

// Create agent modal
const createAgentModal = document.getElementById('create-agent-modal') as HTMLDivElement;
const agentNameInput = document.getElementById('agent-name') as HTMLInputElement;
const agentRoleSelect = document.getElementById('agent-role') as HTMLSelectElement;
const btnCreateCancel = document.getElementById('btn-create-cancel') as HTMLButtonElement;
const btnCreateConfirm = document.getElementById('btn-create-confirm') as HTMLButtonElement;

// ── State ──

let port: chrome.runtime.Port | null = null;
let activeAgentId: string | null = null;
let isStreaming = false;
let pageContext: { title: string; url: string; content: string } | null = null;
let currentStreamEl: HTMLDivElement | null = null;
let currentStreamContent = '';
let reconnectAttempts = 0;

// Conversation history for persistence
interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  pageContext?: { title: string; url: string };
}

let conversationHistory: ConversationEntry[] = [];
const MAX_RECONNECT_RETRIES = 3;
let isCreatingAgent = false;

// ── Port connection ──

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: 'chaos-sidepanel' });

  p.onMessage.addListener((msg: Record<string, unknown>) => {
    handlePortMessage(msg);
    // Check setup state when apiKeys arrive
    if (msg.type === 'apiKeys') {
      checkApiKeysForSetup(msg.keys as ApiKeys);
    }
  });

  p.onDisconnect.addListener(() => {
    console.log('Port disconnected');
    port = null;

    if (reconnectAttempts < MAX_RECONNECT_RETRIES) {
      const delay = Math.pow(2, reconnectAttempts) * 1000; // 1s, 2s, 4s
      reconnectAttempts++;
      addSystemMessage(`Connection lost. Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT_RETRIES})`);
      setTimeout(() => {
        try {
          port = connectPort();
          reconnectAttempts = 0;
          addSystemMessage('Reconnected.');
          sendMessage({ type: 'listAgents' });
        } catch {
          // Will be handled by next disconnect
        }
      }, delay);
    } else {
      addSystemMessage('Could not reconnect to the background service. Please reload the side panel.');
    }
  });

  return p;
}

function sendMessage(msg: Record<string, unknown>): void {
  if (!port) {
    port = connectPort();
  }
  port.postMessage(msg);
}

// ── Port message handler ──

function handlePortMessage(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'agentList':
      populateAgentSelect(msg.agents as AgentMeta[]);
      break;

    case 'agentCreated': {
      const agent = msg.agent as AgentMeta;
      addAgentOption(agent);
      agentSelect.value = agent.id;
      activeAgentId = agent.id;
      addSystemMessage(`Agent "${agent.name}" created.`);
      createAgentModal.classList.remove('visible');
      // Refresh agent list everywhere (chat selector + agents panel)
      sendMessage({ type: 'listAgents' });
      break;
    }

    case 'agentDeleted':
      sendMessage({ type: 'listAgents' });
      addSystemMessage('Agent deleted.');
      break;

    case 'chatStart':
      isStreaming = true;
      currentStreamContent = '';
      currentStreamEl = addAssistantMessage('');
      typingIndicator.classList.add('visible');
      btnSend.disabled = true;
      break;

    case 'chatChunk':
      if (currentStreamEl) {
        currentStreamContent += msg.chunk as string;
        renderMarkdown(currentStreamEl, currentStreamContent);
        scrollToBottom();
      }
      break;

    case 'chatEnd':
      isStreaming = false;
      typingIndicator.classList.remove('visible');
      btnSend.disabled = false;
      if (currentStreamEl && msg.fullResponse) {
        renderMarkdown(currentStreamEl, msg.fullResponse as string);
      }
      // Save assistant response to conversation history
      if (msg.fullResponse) {
        conversationHistory.push({
          role: 'assistant',
          content: msg.fullResponse as string,
          timestamp: new Date().toISOString(),
        });
        saveConversation();
      }
      currentStreamEl = null;
      currentStreamContent = '';
      scrollToBottom();
      break;

    case 'chatError':
      isStreaming = false;
      typingIndicator.classList.remove('visible');
      btnSend.disabled = false;
      // Remove the streaming message element if it exists
      if (currentStreamEl) {
        currentStreamEl.remove();
      }
      currentStreamEl = null;
      currentStreamContent = '';
      addErrorMessage(
        msg.error as string,
        msg.provider as string | undefined,
        msg.lastMessage as { agentId: string; message: string; pageContext?: unknown } | undefined,
      );
      break;

    case 'extractedContent':
      if (msg.content) {
        const content = msg.content as { title: string; url: string; content: string };
        pageContext = content;
        pageContextText.textContent = `Page loaded: ${content.title}`;
        pageContextBar.classList.add('visible');
        addSystemMessage(`Page content loaded: "${content.title}"`);
      } else {
        addSystemMessage(`Could not extract page content: ${msg.error || 'unknown error'}`);
      }
      break;

    case 'apiKeys':
      populateApiKeys(msg.keys as ApiKeys);
      break;

    case 'settings': {
      const s = msg.settings as Record<string, string> | undefined;
      if (s?.activeProvider) {
        providerSelect.value = s.activeProvider;
      }
      break;
    }

    case 'apiKeysSaved':
      settingsModal.classList.remove('visible');
      addSystemMessage('Settings saved.');
      sendMessage({ type: 'getApiKeys' });
      break;

    case 'conversationLoaded': {
      const loadedMessages = msg.messages as ConversationEntry[];
      conversationHistory = loadedMessages;
      // Re-render the conversation in the UI
      messagesDiv.innerHTML = '';
      for (const entry of loadedMessages) {
        if (entry.role === 'user') {
          addUserMessage(entry.content);
        } else if (entry.role === 'assistant') {
          addAssistantMessage(entry.content);
        } else if (entry.role === 'system') {
          addSystemMessage(entry.content);
        }
      }
      break;
    }

    case 'conversationSaved':
      // Silent acknowledgement
      break;

    case 'conversationCleared':
      conversationHistory = [];
      messagesDiv.innerHTML = '';
      addSystemMessage('Conversation cleared.');
      break;

    case 'agentDetail': {
      const detail = msg as { agentId: string; claudeMd: string };
      agentClaudeMdCache[detail.agentId] = detail.claudeMd;
      const preview = document.getElementById(`agent-claude-md-${detail.agentId}`);
      if (preview) preview.textContent = detail.claudeMd || '(empty)';
      break;
    }

    case 'agentVisibilityUpdated':
      // Refresh agents panel if visible
      if (expandedAgentId) loadAgentsPanel();
      break;

    case 'claudeMdUpdated':
      // Silent acknowledgement
      break;

    case 'agentFiles': {
      const files = msg.files as FileEntry[];
      spFileTree.innerHTML = '';
      if (files.length === 0) {
        spFileTree.innerHTML = '<div style="padding:20px;text-align:center;color:#666;font-size:12px;">No files found.</div>';
      } else {
        renderFileTree(files, spFileTree);
      }
      break;
    }

    case 'agentFileContent': {
      spFileViewerContent.textContent = msg.content as string;
      break;
    }

    case 'error':
      addSystemMessage(`Error: ${msg.error}`);
      break;
  }

  // Also update agents/files panels when agent list arrives
  if (msg.type === 'agentList') {
    const agents = msg.agents as AgentMeta[];
    renderAgentsPanel(agents);
    populateFilesAgentSelect(agents);
  }
}

// ── Agent select ──

function populateAgentSelect(agents: AgentMeta[]): void {
  // Clear all but the placeholder
  while (agentSelect.options.length > 1) {
    agentSelect.remove(1);
  }

  for (const agent of agents) {
    addAgentOption(agent);
  }

  // Restore active agent or select first
  if (activeAgentId) {
    agentSelect.value = activeAgentId;
  } else if (agents.length > 0) {
    agentSelect.value = agents[0].id;
    activeAgentId = agents[0].id;
  }

  // Load conversation for the active agent
  if (activeAgentId) {
    sendMessage({ type: 'getConversation', agentId: activeAgentId });
  }
}

function addAgentOption(agent: AgentMeta): void {
  const opt = document.createElement('option');
  opt.value = agent.id;
  opt.textContent = `${agent.name} (${agent.role})`;
  agentSelect.appendChild(opt);
}

agentSelect.addEventListener('change', () => {
  // Save current conversation before switching
  saveConversation();

  activeAgentId = agentSelect.value || null;
  messagesDiv.innerHTML = '';
  conversationHistory = [];
  pageContext = null;
  pageContextBar.classList.remove('visible');

  if (activeAgentId) {
    // Load conversation for the new agent
    sendMessage({ type: 'getConversation', agentId: activeAgentId });
  }
});

// ── Message rendering ──

function addUserMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'message user';
  el.textContent = text;
  messagesDiv.appendChild(el);
  scrollToBottom();
}

function addAssistantMessage(content: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'message assistant';
  if (content) {
    renderMarkdown(el, content);
  }
  messagesDiv.appendChild(el);
  scrollToBottom();
  return el;
}

function addSystemMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'message system';
  el.textContent = text;
  messagesDiv.appendChild(el);
  scrollToBottom();
}

function addErrorMessage(
  error: string,
  provider?: string,
  lastMessage?: { agentId: string; message: string; pageContext?: unknown },
): void {
  const el = document.createElement('div');
  el.className = 'message error';

  const icon = document.createElement('span');
  icon.className = 'error-icon';
  icon.textContent = '\u26A0'; // warning sign
  el.appendChild(icon);

  const textEl = document.createElement('span');
  const providerText = provider ? ` (${provider})` : '';
  textEl.textContent = `${error}${providerText}`;
  el.appendChild(textEl);

  if (lastMessage) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-sm btn-retry';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      el.remove();
      const msg: Record<string, unknown> = {
        type: 'chat',
        agentId: lastMessage.agentId,
        message: lastMessage.message,
      };
      if (lastMessage.pageContext) {
        msg.pageContext = lastMessage.pageContext;
      }
      sendMessage(msg);
    });
    el.appendChild(retryBtn);
  }

  messagesDiv.appendChild(el);
  scrollToBottom();
}

function showLoadingState(message: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'message system loading';
  el.textContent = message;
  messagesDiv.appendChild(el);
  scrollToBottom();
  return el;
}

function renderMarkdown(el: HTMLDivElement, content: string): void {
  const rawHtml = marked.parse(content) as string;
  const sanitized = DOMPurify.sanitize(rawHtml);

  if (needsSandbox(rawHtml)) {
    // Rich content with scripts/styles/forms/iframes: render in sandboxed iframe
    el.innerHTML = '';
    renderInSandbox(sanitized, el);
  } else {
    // Plain markdown: render directly (simpler, faster)
    el.innerHTML = sanitized;
  }
}

function scrollToBottom(): void {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ── Send message ──

function sendChatMessage(): void {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  if (!activeAgentId) {
    addSystemMessage('Please select or create an agent first.');
    return;
  }

  addUserMessage(text);
  chatInput.value = '';
  autoResize();

  // Save user message to conversation history
  const entry: ConversationEntry = {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  };

  const msg: Record<string, unknown> = {
    type: 'chat',
    agentId: activeAgentId,
    message: text,
  };

  // Attach page context if available
  if (pageContext) {
    msg.pageContext = pageContext;
    entry.pageContext = { title: pageContext.title, url: pageContext.url };
    // Clear page context after using it
    pageContext = null;
    pageContextBar.classList.remove('visible');
  }

  conversationHistory.push(entry);
  sendMessage(msg);
}

/** Save conversation to IndexedDB via background. */
function saveConversation(): void {
  if (!activeAgentId || conversationHistory.length === 0) return;
  sendMessage({
    type: 'saveConversation',
    agentId: activeAgentId,
    messages: conversationHistory,
  });
}

/** Clear conversation for the active agent. */
function clearConversation(): void {
  if (!activeAgentId) return;
  sendMessage({ type: 'clearConversation', agentId: activeAgentId });
}

btnSend.addEventListener('click', sendChatMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// ── Auto-resize textarea ──

function autoResize(): void {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}

chatInput.addEventListener('input', autoResize);

// ── Read page button ──

btnReadPage.addEventListener('click', async () => {
  // Check if we have the required permissions first
  const hasScripting = await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  if (!hasScripting) {
    // Request permission from the user
    const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) {
      addSystemMessage('Permission denied. Enable "Read page content" in Settings to use this feature.');
      return;
    }
  }
  sendMessage({ type: 'extractContent' });
});

// ── Clear conversation ──

btnClearChat.addEventListener('click', () => {
  clearConversation();
});

// ── Dismiss page context ──

btnDismissContext.addEventListener('click', () => {
  pageContext = null;
  pageContextBar.classList.remove('visible');
});

// ── Settings modal ──

async function loadBrowserPermissions(): Promise<void> {
  const container = document.getElementById('browser-permissions');
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
    rows.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid #222;">
      <span style="color:#ccc;">${perm.label}</span>
      <button class="browser-perm-btn" data-perm="${perm.permission}" data-needs-host="${perm.needsHost}"
        style="padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;border:1px solid ${granted ? '#16a34a' : '#2563eb'};background:${granted ? '#14532d' : '#1e3a5f'};color:${granted ? '#86efac' : '#93c5fd'};">
        ${granted ? 'Enabled' : 'Enable'}
      </button>
    </div>`);
  }
  container.innerHTML = rows.join('');

  // Wire up enable buttons
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
          btn.style.borderColor = '#16a34a';
          btn.style.background = '#14532d';
          btn.style.color = '#86efac';
        } else {
          btn.textContent = 'Denied';
          btn.style.borderColor = '#dc2626';
          btn.style.background = '#450a0a';
          btn.style.color = '#fca5a5';
          // Show inline error
          const errMsg = document.createElement('div');
          errMsg.textContent = `"${label}" permission was denied. Your browser or IT policy may be blocking this.`;
          errMsg.style.cssText = 'font-size:11px;color:#fca5a5;margin-top:4px;padding:4px 8px;background:#450a0a;border-radius:4px;';
          btn.parentElement?.appendChild(errMsg);
          setTimeout(() => {
            errMsg.remove();
            btn.textContent = 'Enable';
            btn.style.borderColor = '#2563eb';
            btn.style.background = '#1e3a5f';
            btn.style.color = '#93c5fd';
          }, 5000);
        }
      } catch (err) {
        btn.textContent = 'Error';
        btn.style.borderColor = '#dc2626';
        btn.style.background = '#450a0a';
        btn.style.color = '#fca5a5';
        const errMsg = document.createElement('div');
        errMsg.textContent = `Failed to request "${label}": ${err instanceof Error ? err.message : String(err)}`;
        errMsg.style.cssText = 'font-size:11px;color:#fca5a5;margin-top:4px;padding:4px 8px;background:#450a0a;border-radius:4px;';
        btn.parentElement?.appendChild(errMsg);
        setTimeout(() => {
          errMsg.remove();
          btn.textContent = 'Enable';
          btn.style.borderColor = '#2563eb';
          btn.style.background = '#1e3a5f';
          btn.style.color = '#93c5fd';
        }, 5000);
      }
    });
  });
}

async function loadSidePanelPermissions(): Promise<void> {
  const container = document.getElementById('sp-permissions');
  if (!container) return;
  const perms = await getAllPermissions();
  const toolNames = Object.keys(DEFAULT_PERMISSIONS).sort();
  container.innerHTML = toolNames
    .map((name) => {
      const level = perms[name] ?? 'ask';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:12px;">
        <span style="font-family:monospace;color:#ccc;">${name}</span>
        <select class="sp-perm-select" data-tool="${name}" style="background:#0d0d0d;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:2px 6px;font-size:11px;">
          <option value="always"${level === 'always' ? ' selected' : ''}>Always</option>
          <option value="ask"${level === 'ask' ? ' selected' : ''}>Ask</option>
          <option value="never"${level === 'never' ? ' selected' : ''}>Never</option>
        </select>
      </div>`;
    })
    .join('');
}

function openSettings(): void {
  sendMessage({ type: 'getApiKeys' });
  sendMessage({ type: 'getSettings' });
  loadSidePanelPermissions();
  loadBrowserPermissions();
  settingsModal.classList.add('visible');
}

btnSettings.addEventListener('click', openSettings);
btnOpenSettings.addEventListener('click', openSettings);

btnSettingsCancel.addEventListener('click', () => {
  settingsModal.classList.remove('visible');
});

btnSettingsSave.addEventListener('click', async () => {
  const keys: Record<string, string> = {};
  if (keyAnthropicInput.value.trim()) keys.anthropic = keyAnthropicInput.value.trim();
  if (keyGoogleInput.value.trim()) keys.google = keyGoogleInput.value.trim();
  if (keyOpenaiInput.value.trim()) keys.openai = keyOpenaiInput.value.trim();
  if (keyOpenrouterInput.value.trim()) keys.openrouter = keyOpenrouterInput.value.trim();

  sendMessage({ type: 'setApiKeys', keys });
  sendMessage({ type: 'setSettings', settings: { activeProvider: providerSelect.value } });

  // Save tool permissions
  const selects = document.querySelectorAll<HTMLSelectElement>('.sp-perm-select');
  for (const sel of selects) {
    const toolName = sel.dataset.tool!;
    const level = sel.value as PermissionLevel;
    await setPermission(toolName, level);
  }
});

function populateApiKeys(keys: ApiKeys): void {
  keyAnthropicInput.value = keys.anthropic || '';
  keyGoogleInput.value = keys.google || '';
  keyOpenaiInput.value = keys.openai || '';
  keyOpenrouterInput.value = keys.openrouter || '';
}

// ── Create agent modal ──

btnNewAgent.addEventListener('click', () => {
  agentNameInput.value = '';
  agentRoleSelect.value = 'neutral';
  createAgentModal.classList.add('visible');
});

btnCreateCancel.addEventListener('click', () => {
  createAgentModal.classList.remove('visible');
});

btnCreateConfirm.addEventListener('click', () => {
  const name = agentNameInput.value.trim();
  if (!name) {
    agentNameInput.focus();
    return;
  }
  const role = agentRoleSelect.value;
  const visibilityEl = document.getElementById('agent-visibility') as HTMLSelectElement | null;
  const visibility = visibilityEl?.value || 'private';
  isCreatingAgent = true;
  const loadingEl = showLoadingState('Creating agent...');
  sendMessage({ type: 'createAgent', name, role, visibility });
  // Loading state is cleared when agentCreated message arrives
  const clearLoading = (msg: Record<string, unknown>) => {
    if (msg.type === 'agentCreated' || msg.type === 'error') {
      isCreatingAgent = false;
      loadingEl.remove();
    }
  };
  port?.onMessage.addListener(clearLoading);
});

// Close modals on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.remove('visible');
});

createAgentModal.addEventListener('click', (e) => {
  if (e.target === createAgentModal) createAgentModal.classList.remove('visible');
});

// ── Setup state check ──

function checkApiKeysForSetup(keys: ApiKeys): void {
  const hasKey = !!(keys.anthropic || keys.google || keys.openai || keys.openrouter);
  if (hasKey) {
    setupPrompt.classList.remove('visible');
  } else {
    setupPrompt.classList.add('visible');
  }
}

// ── Tab switching ──

const spTabs = document.querySelectorAll<HTMLButtonElement>('.sp-tab');
const spPanels = document.querySelectorAll<HTMLDivElement>('.sp-panel');

spTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.spTab;
    spTabs.forEach((t) => t.classList.remove('active'));
    spPanels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`sp-${target}`);
    panel?.classList.add('active');

    // Load data when switching to a tab
    if (target === 'agents') {
      loadAgentsPanel();
    } else if (target === 'files') {
      loadFilesPanelAgents();
    }
  });
});

// ── Agents panel ──

const spAgentsList = document.getElementById('sp-agents-list') as HTMLDivElement;
const btnAgentsCreate = document.getElementById('btn-agents-create') as HTMLButtonElement;

// Track agents panel data
let expandedAgentId: string | null = null;
let agentClaudeMdCache: Record<string, string> = {};

function loadAgentsPanel(): void {
  // Request fresh agent list
  sendMessage({ type: 'listAgents' });
}

// Hook into agentList responses for the agents panel
function renderAgentsPanel(agents: AgentMeta[]): void {
  spAgentsList.innerHTML = '';

  if (agents.length === 0) {
    spAgentsList.innerHTML = '<div style="padding:20px;text-align:center;color:#666;font-size:12px;">No agents yet. Create one to get started.</div>';
    return;
  }

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = 'sp-agent-card';
    card.dataset.agentId = agent.id;

    const visClass = agent.visibility === 'private' ? 'visibility-private' : agent.visibility === 'open' ? 'visibility-open' : 'visibility';

    card.innerHTML = `
      <div class="sp-agent-card-header">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="sp-badge role">${escapeHtml(agent.role)}</span>
        <span class="sp-badge ${visClass}">${escapeHtml(agent.visibility)}</span>
      </div>
      <div class="sp-agent-detail" id="agent-detail-${agent.id}"></div>
    `;

    card.querySelector('.sp-agent-card-header')!.addEventListener('click', () => {
      toggleAgentDetail(agent);
    });

    spAgentsList.appendChild(card);

    // Re-expand if this was the previously expanded agent
    if (expandedAgentId === agent.id) {
      showAgentDetail(agent);
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toggleAgentDetail(agent: AgentMeta): void {
  if (expandedAgentId === agent.id) {
    // Collapse
    const detail = document.getElementById(`agent-detail-${agent.id}`);
    detail?.classList.remove('open');
    expandedAgentId = null;
  } else {
    // Collapse previous
    if (expandedAgentId) {
      const prevDetail = document.getElementById(`agent-detail-${expandedAgentId}`);
      prevDetail?.classList.remove('open');
    }
    expandedAgentId = agent.id;
    showAgentDetail(agent);
  }
}

function showAgentDetail(agent: AgentMeta): void {
  const detail = document.getElementById(`agent-detail-${agent.id}`);
  if (!detail) return;

  // Request CLAUDE.md via port
  sendMessage({ type: 'getAgentDetail', agentId: agent.id });

  detail.innerHTML = `
    <div class="sp-agent-visibility-row">
      <span>Visibility:</span>
      <select class="agent-vis-select" data-agent-id="${agent.id}">
        <option value="private"${agent.visibility === 'private' ? ' selected' : ''}>Private</option>
        <option value="visible"${agent.visibility === 'visible' ? ' selected' : ''}>Visible</option>
        <option value="open"${agent.visibility === 'open' ? ' selected' : ''}>Open</option>
      </select>
    </div>
    <div class="sp-agent-detail-actions">
      <button class="edit-claude-md-btn" data-agent-id="${agent.id}">Edit CLAUDE.md</button>
      <button class="danger delete-agent-btn" data-agent-id="${agent.id}">Delete</button>
    </div>
    <div class="sp-agent-claude-md" id="agent-claude-md-${agent.id}">Loading...</div>
  `;

  detail.classList.add('open');

  // Wire up visibility select
  const visSelect = detail.querySelector('.agent-vis-select') as HTMLSelectElement;
  visSelect.addEventListener('change', () => {
    sendMessage({ type: 'updateAgentVisibility', agentId: agent.id, visibility: visSelect.value });
    // Update local state
    agent.visibility = visSelect.value as 'private' | 'visible' | 'open';
  });

  // Wire up edit CLAUDE.md button
  const editBtn = detail.querySelector('.edit-claude-md-btn') as HTMLButtonElement;
  editBtn.addEventListener('click', () => {
    openClaudeMdEditor(agent.id);
  });

  // Wire up delete button
  const deleteBtn = detail.querySelector('.delete-agent-btn') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    if (deleteBtn.dataset.confirmed === 'true') {
      sendMessage({ type: 'deleteAgent', agentId: agent.id });
      expandedAgentId = null;
      loadAgentsPanel();
    } else {
      deleteBtn.textContent = 'Confirm Delete';
      deleteBtn.dataset.confirmed = 'true';
      setTimeout(() => {
        deleteBtn.textContent = 'Delete';
        deleteBtn.dataset.confirmed = '';
      }, 3000);
    }
  });
}

function openClaudeMdEditor(agentId: string): void {
  const overlay = document.getElementById('sp-editor-overlay') as HTMLDivElement;
  const textarea = document.getElementById('sp-editor-textarea') as HTMLTextAreaElement;
  const cancelBtn = document.getElementById('sp-editor-cancel') as HTMLButtonElement;
  const saveBtn = document.getElementById('sp-editor-save') as HTMLButtonElement;

  textarea.value = agentClaudeMdCache[agentId] || '';
  overlay.classList.add('visible');

  const cleanup = () => {
    overlay.classList.remove('visible');
    cancelBtn.removeEventListener('click', handleCancel);
    saveBtn.removeEventListener('click', handleSave);
  };

  const handleCancel = () => cleanup();
  const handleSave = () => {
    sendMessage({ type: 'updateAgentClaudeMd', agentId, content: textarea.value });
    agentClaudeMdCache[agentId] = textarea.value;
    // Update the preview
    const preview = document.getElementById(`agent-claude-md-${agentId}`);
    if (preview) preview.textContent = textarea.value;
    cleanup();
  };

  cancelBtn.addEventListener('click', handleCancel);
  saveBtn.addEventListener('click', handleSave);
}

// Agents panel create button uses the same modal
btnAgentsCreate.addEventListener('click', () => {
  agentNameInput.value = '';
  agentRoleSelect.value = 'neutral';
  createAgentModal.classList.add('visible');
});

// ── Files panel ──

const spFilesAgentSelect = document.getElementById('sp-files-agent-select') as HTMLSelectElement;
const spFileTree = document.getElementById('sp-file-tree') as HTMLDivElement;
const spFileViewer = document.getElementById('sp-file-viewer') as HTMLDivElement;
const spFileViewerPath = document.getElementById('sp-file-viewer-path') as HTMLSpanElement;
const spFileViewerContent = document.getElementById('sp-file-viewer-content') as HTMLDivElement;
const spFileViewerClose = document.getElementById('sp-file-viewer-close') as HTMLButtonElement;

interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

let filesAgentId: string | null = null;

function loadFilesPanelAgents(): void {
  // Request agent list to populate selector
  sendMessage({ type: 'listAgents' });
}

function populateFilesAgentSelect(agents: AgentMeta[]): void {
  // Clear all but placeholder
  while (spFilesAgentSelect.options.length > 1) {
    spFilesAgentSelect.remove(1);
  }
  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = agent.name;
    spFilesAgentSelect.appendChild(opt);
  }
  // Restore selection
  if (filesAgentId) {
    spFilesAgentSelect.value = filesAgentId;
  }
}

spFilesAgentSelect.addEventListener('change', () => {
  filesAgentId = spFilesAgentSelect.value || null;
  spFileViewer.classList.remove('visible');
  if (filesAgentId) {
    sendMessage({ type: 'listAgentFiles', agentId: filesAgentId });
  } else {
    spFileTree.innerHTML = '';
  }
});

function renderFileTree(entries: FileEntry[], container: HTMLElement, depth: number = 0): void {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'sp-file-tree-item';
    item.style.paddingLeft = `${12 + depth * 16}px`;

    if (entry.kind === 'directory') {
      let expanded = false;
      const childContainer = document.createElement('div');
      childContainer.style.display = 'none';

      item.innerHTML = `<span class="icon"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span><span class="name">${escapeHtml(entry.name)}/</span>`;
      item.addEventListener('click', () => {
        expanded = !expanded;
        childContainer.style.display = expanded ? 'block' : 'none';
        item.querySelector('.icon')!.innerHTML = expanded ? '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>' : '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      });

      container.appendChild(item);
      container.appendChild(childContainer);

      if (entry.children && entry.children.length > 0) {
        renderFileTree(entry.children, childContainer, depth + 1);
      }
    } else {
      const sizeStr = entry.size != null ? formatFileSize(entry.size) : '';
      item.innerHTML = `<span class="icon"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="name">${escapeHtml(entry.name)}</span><span class="size">${sizeStr}</span>`;
      item.addEventListener('click', () => {
        if (filesAgentId) {
          sendMessage({ type: 'readAgentFile', agentId: filesAgentId, path: entry.path });
          spFileViewerPath.textContent = entry.path;
          spFileViewerContent.textContent = 'Loading...';
          spFileViewer.classList.add('visible');
        }
      });
      container.appendChild(item);
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

spFileViewerClose.addEventListener('click', () => {
  spFileViewer.classList.remove('visible');
});

// ── Initialization ──

function init(): void {
  port = connectPort();

  // Request agent list
  sendMessage({ type: 'listAgents' });

  // Check API keys for setup prompt
  sendMessage({ type: 'getApiKeys' });
}

init();

// ── Speech-to-text ──

// ── Speech-to-text via offscreen document ──
// SpeechRecognition doesn't work directly in extension pages (chrome-extension:// URLs).
// We use an offscreen document which runs in a normal web context.

let isRecording = false;
let textBeforeRecording = '';

async function ensureOffscreenDocument(): Promise<void> {
  // Check if offscreen document already exists
  const existingContexts = await (chrome.runtime as any).getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts?.length > 0) return;

  try {
    await (chrome as any).offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Speech recognition requires a normal web page context',
    });
  } catch {
    // May already exist
  }
}

btnMic.addEventListener('click', async () => {
  if (isRecording) {
    isRecording = false;
    btnMic.classList.remove('recording');
    chrome.runtime.sendMessage({ type: 'stopSpeechRecognition' });
  } else {
    try {
      await ensureOffscreenDocument();
      isRecording = true;
      textBeforeRecording = chatInput.value;
      btnMic.classList.add('recording');
      chrome.runtime.sendMessage({ type: 'startSpeechRecognition' });
    } catch (err) {
      addSystemMessage(`Could not start voice input: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

// Listen for transcription results from offscreen document (via background)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'speechResult') {
    chatInput.value = textBeforeRecording + msg.transcript;
    chatInput.scrollTop = chatInput.scrollHeight;
  } else if (msg.type === 'speechError') {
    if (msg.error !== 'no-speech' && msg.error !== 'aborted') {
      addSystemMessage(`Speech recognition error: ${msg.error}`);
    }
    isRecording = false;
    btnMic.classList.remove('recording');
  } else if (msg.type === 'speechEnd') {
    isRecording = false;
    btnMic.classList.remove('recording');
  }
});
