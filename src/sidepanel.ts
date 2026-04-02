/**
 * Side Panel UI
 *
 * Chat interface for interacting with CHAOS agents.
 * Communicates with the background service worker via a long-lived port.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentMeta, ApiKeys } from './storage/types.js';
import { needsSandbox, renderInSandbox } from './ui/sandbox-renderer.js';
import { getAllPermissions, setPermission, DEFAULT_PERMISSIONS, type PermissionLevel } from './tools/permissions.js';

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

    case 'apiKeysSaved':
      settingsModal.classList.remove('visible');
      addSystemMessage('API keys saved.');
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

    case 'error':
      addSystemMessage(`Error: ${msg.error}`);
      break;
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

btnReadPage.addEventListener('click', () => {
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

btnSettings.addEventListener('click', () => {
  sendMessage({ type: 'getApiKeys' });
  loadSidePanelPermissions();
  settingsModal.classList.add('visible');
});

btnOpenSettings.addEventListener('click', () => {
  sendMessage({ type: 'getApiKeys' });
  loadSidePanelPermissions();
  settingsModal.classList.add('visible');
});

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
  isCreatingAgent = true;
  const loadingEl = showLoadingState('Creating agent...');
  sendMessage({ type: 'createAgent', name, role });
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

// ── Initialization ──

function init(): void {
  port = connectPort();

  // Request agent list
  sendMessage({ type: 'listAgents' });

  // Check API keys for setup prompt
  sendMessage({ type: 'getApiKeys' });
}

init();
