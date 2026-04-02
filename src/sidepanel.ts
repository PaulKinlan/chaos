/**
 * Side Panel UI
 *
 * Chat interface for interacting with CHAOS agents.
 * Communicates with the background service worker via a long-lived port.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentMeta, ApiKeys } from './storage/types.js';

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

// ── Port connection ──

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: 'chaos-sidepanel' });

  p.onMessage.addListener(handlePortMessage);

  p.onDisconnect.addListener(() => {
    console.log('Port disconnected, reconnecting...');
    port = null;
    // Reconnect after a short delay
    setTimeout(() => {
      port = connectPort();
    }, 500);
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
      currentStreamEl = null;
      currentStreamContent = '';
      scrollToBottom();
      break;

    case 'chatError':
      isStreaming = false;
      typingIndicator.classList.remove('visible');
      btnSend.disabled = false;
      currentStreamEl = null;
      addSystemMessage(`Error: ${msg.error}`);
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
      checkSetupState();
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
}

function addAgentOption(agent: AgentMeta): void {
  const opt = document.createElement('option');
  opt.value = agent.id;
  opt.textContent = `${agent.name} (${agent.role})`;
  agentSelect.appendChild(opt);
}

agentSelect.addEventListener('change', () => {
  activeAgentId = agentSelect.value || null;
  messagesDiv.innerHTML = '';
  pageContext = null;
  pageContextBar.classList.remove('visible');
  if (activeAgentId) {
    addSystemMessage(`Switched to agent.`);
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

function renderMarkdown(el: HTMLDivElement, content: string): void {
  const rawHtml = marked.parse(content) as string;
  el.innerHTML = DOMPurify.sanitize(rawHtml);
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

  const msg: Record<string, unknown> = {
    type: 'chat',
    agentId: activeAgentId,
    message: text,
  };

  // Attach page context if available
  if (pageContext) {
    msg.pageContext = pageContext;
    // Clear page context after using it
    pageContext = null;
    pageContextBar.classList.remove('visible');
  }

  sendMessage(msg);
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

// ── Dismiss page context ──

btnDismissContext.addEventListener('click', () => {
  pageContext = null;
  pageContextBar.classList.remove('visible');
});

// ── Settings modal ──

btnSettings.addEventListener('click', () => {
  sendMessage({ type: 'getApiKeys' });
  settingsModal.classList.add('visible');
});

btnOpenSettings.addEventListener('click', () => {
  sendMessage({ type: 'getApiKeys' });
  settingsModal.classList.add('visible');
});

btnSettingsCancel.addEventListener('click', () => {
  settingsModal.classList.remove('visible');
});

btnSettingsSave.addEventListener('click', () => {
  const keys: Record<string, string> = {};
  if (keyAnthropicInput.value.trim()) keys.anthropic = keyAnthropicInput.value.trim();
  if (keyGoogleInput.value.trim()) keys.google = keyGoogleInput.value.trim();
  if (keyOpenaiInput.value.trim()) keys.openai = keyOpenaiInput.value.trim();
  if (keyOpenrouterInput.value.trim()) keys.openrouter = keyOpenrouterInput.value.trim();

  sendMessage({ type: 'setApiKeys', keys });
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
  sendMessage({ type: 'createAgent', name, role });
});

// Close modals on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.remove('visible');
});

createAgentModal.addEventListener('click', (e) => {
  if (e.target === createAgentModal) createAgentModal.classList.remove('visible');
});

// ── Setup state check ──

async function checkSetupState(): Promise<void> {
  // Check if any API key is configured
  sendMessage({ type: 'getApiKeys' });
}

// Listen for apiKeys to determine setup state
const origHandler = handlePortMessage;
// We handle this inline in the main handler - check if keys exist
// and show/hide setup prompt accordingly

function checkApiKeysForSetup(keys: ApiKeys): void {
  const hasKey = !!(keys.anthropic || keys.google || keys.openai || keys.openrouter);
  if (hasKey) {
    setupPrompt.classList.remove('visible');
  } else {
    setupPrompt.classList.add('visible');
  }
}

// Patch handler to also check setup state when apiKeys arrive
const _origOnMessage = handlePortMessage;
// Already handled in the main handler — the setup check happens
// when we get the agent list on load

// ── Initialization ──

function init(): void {
  port = connectPort();

  // Request agent list
  sendMessage({ type: 'listAgents' });

  // Check API keys for setup prompt
  sendMessage({ type: 'getApiKeys' });

  // We need to check setup state when apiKeys arrive.
  // Patch the apiKeys case to also check setup.
  const checkSetup = (msg: Record<string, unknown>) => {
    if (msg.type === 'apiKeys') {
      checkApiKeysForSetup(msg.keys as ApiKeys);
    }
  };

  // Re-wire port message listener to include setup check
  port.onMessage.removeListener(handlePortMessage);
  port.onMessage.addListener((msg: Record<string, unknown>) => {
    handlePortMessage(msg);
    checkSetup(msg);
  });
}

init();
