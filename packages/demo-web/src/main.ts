/**
 * CHAOS SDK Demo — vanilla web app
 *
 * Proves the SDK works without Chrome APIs:
 *   - In-memory stores (from @chaos/sdk stores)
 *   - Agent-loop with MockModel (no real LLM, no engine connection)
 *   - Standard DOM, runs in any browser
 */

import { createAgent } from 'agent-do';
import { createMockModel } from 'agent-do/testing';
import { ChaosSDK } from '@chaos/sdk';
import type { AgentMeta, ProgressUpdate } from '@chaos/sdk';
import {
  InMemorySettingsStore,
  InMemoryMemoryStore,
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from '../../sdk/src/stores/in-memory.js';

// ── Initialize SDK ──────────────

const agentStore = new InMemoryAgentStore();

const sdk = new ChaosSDK({
  settings: new InMemorySettingsStore(),
  memory: new InMemoryMemoryStore(),
  conversations: new InMemoryConversationStore(),
  hooks: new InMemoryHookStore(),
  usage: new InMemoryUsageStore(),
  agentStore: agentStore,
  // No agentLoops yet — agents are registered dynamically when created
});

console.log('[Demo] ChaosSDK initialized with agent-loop + MockModel (no engine connection)');

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

async function createNewAgent(name: string, role: string): Promise<void> {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const meta: AgentMeta = {
    id,
    name,
    role,
    visibility: 'private',
    createdAt: new Date().toISOString(),
  };
  await agentStore.add(meta);

  // Create an agent loop for this agent — each agent has its own model/config
  const agentLoop = createAgent({
    id,
    name,
    model: createMockModel({
      responses: [
        { text: `Hello! I'm ${name}. I'm running with a MockModel — no real LLM needed.` },
      ],
    }) as any,
    maxIterations: 5,
  });
  sdk.chat.registerAgent(agentLoop);

  selectAgent(meta.id);
  log('agent.created', `${meta.name} (${meta.id})`);
  renderAgentList();
}

async function deleteSelectedAgent(): Promise<void> {
  if (!selectedAgentId) return;
  const id = selectedAgentId;
  chatMessages.delete(id);
  await agentStore.remove(id);
  log('agent.deleted', id);
  selectedAgentId = null;
  renderChat();
  updateInputState();
  renderAgentList();
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

  // Stream agentic chat via agent-loop
  let fullReply = '';
  try {
    const stream = sdk.chat.sendMessage(selectedAgentId, text, {
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
  createNewAgent(name, role || 'General assistant');
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

log('sdk.init', 'ChaosSDK initialized with agent-loop + MockModel (no engine connection)');
log('sdk.info', 'No Chrome APIs, no frameworks, no engine - pure SDK + agent-loop + DOM');
renderAgentList();
renderChat();
updateInputState();
