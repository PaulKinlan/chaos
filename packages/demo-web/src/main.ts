/**
 * CHAOS SDK Demo — vanilla web app
 *
 * Proves the SDK works without Chrome APIs:
 *   - In-memory stores (from @chaos/sdk/stores)
 *   - Mock EngineConnection (no real LLM)
 *   - Standard DOM, runs in any browser
 */

import { ChaosSDK } from '@chaos/sdk';
import type { AgentMeta, ProgressUpdate } from '@chaos/sdk';
import type { EngineConnection } from '@chaos/sdk/connections';
import type { ApiMessage, ApiResponse, ApiEvent } from '@chaos/sdk/connections';
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '../../sdk/src/stores/in-memory.js';

// ── Mock Engine ──────────────────────────────────────────────────────

/** A fake engine that returns canned responses — no network, no LLM. */
class MockEngineConnection implements EngineConnection {
  private agentStore: InMemoryAgentStore;
  private nextId = 1;

  constructor(agentStore: InMemoryAgentStore) {
    this.agentStore = agentStore;
  }

  async send(message: ApiMessage): Promise<ApiResponse> {
    console.log('[MockEngine] send:', message.type, message);

    switch (message.type) {
      case 'createAgent': {
        const agent: AgentMeta = {
          id: `agent-${this.nextId++}`,
          name: message.name as string,
          role: message.role as string,
          visibility: 'private',
          createdAt: new Date().toISOString(),
        };
        await this.agentStore.add(agent);
        return agent as unknown as ApiResponse;
      }

      case 'deleteAgent': {
        await this.agentStore.remove(message.agentId as string);
        return { ok: true };
      }

      case 'getAgentDetail': {
        const meta = await this.agentStore.get(message.agentId as string);
        return {
          ...meta,
          claudeMd: '# Agent Instructions\n\nYou are a helpful assistant.',
          journal: [],
          bookmarks: [],
        } as unknown as ApiResponse;
      }

      default:
        return { ok: true };
    }
  }

  async *stream(message: ApiMessage): AsyncIterable<ApiEvent> {
    console.log('[MockEngine] stream:', message.type, message);

    if (message.type === 'agenticChat' || message.type === 'chat') {
      const userMsg = (message.message as string) || '';

      // Simulate thinking
      yield { type: 'thinking', content: 'Analyzing the request...' } as ApiEvent;
      await delay(400);

      // Simulate a tool call
      yield {
        type: 'tool-call',
        content: '',
        toolName: 'web_search',
        toolArgs: { query: userMsg },
      } as ApiEvent;
      await delay(300);

      yield {
        type: 'tool-result',
        content: '',
        toolName: 'web_search',
        toolResult: { results: ['Mock result 1', 'Mock result 2'] },
      } as ApiEvent;
      await delay(200);

      // Step complete
      yield {
        type: 'step-complete',
        content: '',
        iteration: 1,
        totalIterations: 1,
      } as ApiEvent;
      await delay(100);

      // Final text
      const reply = generateMockReply(userMsg);
      yield { type: 'text', content: reply } as ApiEvent;
      await delay(100);

      // Done
      yield { type: 'done', content: reply } as ApiEvent;
    }
  }

  subscribe(_event: string, _handler: (data: unknown) => void): () => void {
    // No-op for the demo
    return () => {};
  }

  disconnect(): void {
    console.log('[MockEngine] disconnected');
  }
}

function generateMockReply(userMsg: string): string {
  const lower = userMsg.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi')) {
    return 'Hello! I am a mock agent running entirely in your browser. The CHAOS SDK is working without any Chrome APIs.';
  }
  if (lower.includes('help')) {
    return 'I can demonstrate the SDK\'s agent management, chat streaming, and event system. Try creating more agents in the sidebar, or ask me anything.';
  }
  return `I received your message: "${userMsg}"\n\nThis is a mock response from the in-memory engine. In a real setup, this would be powered by an LLM via the CHAOS engine. The key point: the SDK itself has zero coupling to Chrome extension APIs.`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Initialize SDK ──────────────────────────────────────────────────

const agentStore = new InMemoryAgentStore();

const sdk = new ChaosSDK({
  engine: new MockEngineConnection(agentStore),
  settings: new InMemorySettingsStore(),
  memory: new InMemoryMemoryStore(),
  conversations: new InMemoryConversationStore(),
  hooks: new InMemoryHookStore(),
  usage: new InMemoryUsageStore(),
  agents: agentStore,
});

console.log('[Demo] ChaosSDK initialized with in-memory stores');

// ── DOM references ──────────────────────────────────────────────────

const agentListEl = document.getElementById('agent-list')!;
const chatAreaEl = document.getElementById('chat-area')!;
const emptyStateEl = document.getElementById('empty-state')!;
const chatInputEl = document.getElementById('chat-input') as HTMLInputElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const btnDelete = document.getElementById('btn-delete') as HTMLButtonElement;
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
const dialogOverlay = document.getElementById('dialog-overlay')!;
const agentNameInput = document.getElementById('agent-name') as HTMLInputElement;
const agentRoleInput = document.getElementById('agent-role') as HTMLInputElement;
const btnCancel = document.getElementById('btn-cancel')!;
const btnConfirm = document.getElementById('btn-confirm')!;
const logAreaEl = document.getElementById('log-area')!;

// ── State ───────────────────────────────────────────────────────────

let selectedAgentId: string | null = null;
const chatMessages: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();

// ── Activity log ────────────────────────────────────────────────────

function log(event: string, detail: string, isError = false): void {
  const ts = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry${isError ? ' error' : ''}`;
  entry.innerHTML = `<span class="timestamp">${ts}</span> <span class="event">[${event}]</span> ${detail}`;
  logAreaEl.appendChild(entry);
  logAreaEl.scrollTop = logAreaEl.scrollHeight;
}

// ── SDK event listeners ─────────────────────────────────────────────

sdk.agents.addEventListener('created', ((e: CustomEvent) => {
  const agent = e.detail as AgentMeta;
  log('agent.created', `${agent.name} (${agent.id})`);
  renderAgentList();
}) as EventListener);

sdk.agents.addEventListener('deleted', ((e: CustomEvent) => {
  const { agentId } = e.detail as { agentId: string };
  log('agent.deleted', agentId);
  if (selectedAgentId === agentId) {
    selectedAgentId = null;
    renderChat();
    updateInputState();
  }
  renderAgentList();
}) as EventListener);

sdk.chat.addEventListener('start', ((e: CustomEvent) => {
  const { agentId } = e.detail as { agentId: string };
  log('chat.start', `agent=${agentId}`);
}) as EventListener);

sdk.chat.addEventListener('chunk', ((e: CustomEvent) => {
  const { chunk } = e.detail as { chunk: string };
  log('chat.chunk', `${chunk.slice(0, 60)}${chunk.length > 60 ? '...' : ''}`);
}) as EventListener);

sdk.chat.addEventListener('toolCall', ((e: CustomEvent) => {
  const { toolName, args } = e.detail as { toolName: string; args: unknown };
  log('chat.toolCall', `${toolName}(${JSON.stringify(args).slice(0, 80)})`);
}) as EventListener);

sdk.chat.addEventListener('toolResult', ((e: CustomEvent) => {
  const { toolName } = e.detail as { toolName: string };
  log('chat.toolResult', `${toolName} returned`);
}) as EventListener);

sdk.chat.addEventListener('stepComplete', ((e: CustomEvent) => {
  const { step } = e.detail as { step: number };
  log('chat.stepComplete', `step ${step}`);
}) as EventListener);

sdk.chat.addEventListener('done', ((e: CustomEvent) => {
  const { agentId } = e.detail as { agentId: string };
  log('chat.done', `agent=${agentId}`);
}) as EventListener);

sdk.chat.addEventListener('error', ((e: CustomEvent) => {
  const { error } = e.detail as { error: string };
  log('chat.error', error, true);
}) as EventListener);

// ── Rendering ───────────────────────────────────────────────────────

async function renderAgentList(): Promise<void> {
  const agents = await sdk.agents.list();
  agentListEl.innerHTML = '';
  for (const agent of agents) {
    const el = document.createElement('div');
    el.className = `agent-item${agent.id === selectedAgentId ? ' active' : ''}`;
    el.innerHTML = `<div class="name">${escapeHtml(agent.name)}</div><div class="role">${escapeHtml(agent.role)}</div>`;
    el.addEventListener('click', () => selectAgent(agent.id));
    agentListEl.appendChild(el);
  }
}

function renderChat(): void {
  if (!selectedAgentId) {
    chatAreaEl.innerHTML = '';
    chatAreaEl.appendChild(emptyStateEl);
    emptyStateEl.style.display = 'flex';
    return;
  }

  emptyStateEl.style.display = 'none';
  const messages = chatMessages.get(selectedAgentId) ?? [];
  chatAreaEl.innerHTML = '';

  if (messages.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-state';
    hint.textContent = 'Send a message to start the conversation';
    chatAreaEl.appendChild(hint);
    return;
  }

  for (const msg of messages) {
    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    el.innerHTML = `<div class="sender">${msg.role}</div><div class="content">${escapeHtml(msg.content)}</div>`;
    chatAreaEl.appendChild(el);
  }
  chatAreaEl.scrollTop = chatAreaEl.scrollHeight;
}

function updateInputState(): void {
  const enabled = selectedAgentId !== null;
  chatInputEl.disabled = !enabled;
  btnSend.disabled = !enabled;
  btnDelete.disabled = !enabled;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Actions ─────────────────────────────────────────────────────────

function selectAgent(agentId: string): void {
  selectedAgentId = agentId;
  renderAgentList();
  renderChat();
  updateInputState();
  chatInputEl.focus();
  log('ui.selectAgent', agentId);
}

async function createAgent(name: string, role: string): Promise<void> {
  const agent = await sdk.agents.create(name, role);
  selectAgent(agent.id);
}

async function deleteSelectedAgent(): Promise<void> {
  if (!selectedAgentId) return;
  const id = selectedAgentId;
  chatMessages.delete(id);
  await sdk.agents.delete(id);
}

async function sendMessage(): Promise<void> {
  if (!selectedAgentId) return;
  const text = chatInputEl.value.trim();
  if (!text) return;

  chatInputEl.value = '';
  chatInputEl.disabled = true;
  btnSend.disabled = true;

  // Add user message
  if (!chatMessages.has(selectedAgentId)) {
    chatMessages.set(selectedAgentId, []);
  }
  chatMessages.get(selectedAgentId)!.push({ role: 'user', content: text });
  renderChat();

  // Stream agentic chat
  let fullReply = '';
  try {
    const stream = sdk.chat.sendAgentic(selectedAgentId, text, {
      maxIterations: 3,
      source: 'chat',
    });
    for await (const update of stream) {
      const progress = update as ProgressUpdate;
      if (progress.type === 'text' || progress.type === 'done') {
        fullReply = progress.content;
      }
    }
  } catch (err) {
    fullReply = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Add assistant message
  if (selectedAgentId) {
    chatMessages.get(selectedAgentId)!.push({ role: 'assistant', content: fullReply });
    renderChat();
  }

  chatInputEl.disabled = false;
  btnSend.disabled = false;
  chatInputEl.focus();
}

// ── Event wiring ────────────────────────────────────────────────────

btnCreate.addEventListener('click', () => {
  agentNameInput.value = '';
  agentRoleInput.value = '';
  dialogOverlay.classList.remove('hidden');
  agentNameInput.focus();
});

btnCancel.addEventListener('click', () => {
  dialogOverlay.classList.add('hidden');
});

btnConfirm.addEventListener('click', () => {
  const name = agentNameInput.value.trim();
  const role = agentRoleInput.value.trim();
  if (!name) return;
  dialogOverlay.classList.add('hidden');
  createAgent(name, role || 'General assistant');
});

dialogOverlay.addEventListener('click', (e) => {
  if (e.target === dialogOverlay) {
    dialogOverlay.classList.add('hidden');
  }
});

btnSend.addEventListener('click', sendMessage);

chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

btnDelete.addEventListener('click', () => {
  if (selectedAgentId && confirm('Delete this agent?')) {
    deleteSelectedAgent();
  }
});

// Handle Enter in dialog
agentRoleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnConfirm.click();
  }
});

agentNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    agentRoleInput.focus();
  }
});

// ── Boot ────────────────────────────────────────────────────────────

log('sdk.init', 'ChaosSDK initialized with in-memory stores and mock engine');
log('sdk.info', 'No Chrome APIs, no frameworks - pure SDK + DOM');
renderAgentList();
renderChat();
updateInputState();
