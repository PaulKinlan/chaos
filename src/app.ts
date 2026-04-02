/**
 * Dashboard UI (app.html)
 *
 * Full-tab "operating system view" showing all agents, tasks,
 * messages, artifacts, and settings.
 *
 * Communicates with the background service worker via
 * chrome.runtime.sendMessage (one-shot request/response).
 */

import type { AgentMeta, AgentMessage, Task, ArtifactMeta, ApiKeys } from './storage/types.js';

// ── State ──

let agents: AgentMeta[] = [];
let tasks: Task[] = [];
let messages: AgentMessage[] = [];
let artifacts: ArtifactMeta[] = [];
let expandedAgentId: string | null = null;

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

// ── Messaging helpers ──

async function sendMsg<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

// ── Tab navigation ──

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
      case 'settings':
        loadSettings();
        break;
    }
  });
});

// ══════════════════════════════════════════
// ── Agents Tab
// ══════════════════════════════════════════

async function loadAgents(): Promise<void> {
  const result = await sendMsg<{ agents: AgentMeta[] }>({ type: 'listAgents' });
  agents = result.agents;
  renderAgents();
}

function renderAgents(): void {
  const grid = document.getElementById('agent-grid')!;
  const empty = document.getElementById('agents-empty')!;
  const detail = document.getElementById('agent-detail')!;

  if (agents.length === 0) {
    grid.innerHTML = '';
    detail.innerHTML = '';
    detail.classList.remove('active');
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

  // Attach click handlers
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

  // Visibility change handler
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

  // Delete handler
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

const createAgentBtn = document.getElementById('btn-create-agent')!;
const createAgentModal = document.getElementById('create-agent-modal')!;
const createCancelBtn = document.getElementById('btn-create-cancel')!;
const createConfirmBtn = document.getElementById('btn-create-confirm')!;
const createNameInput = document.getElementById('create-agent-name') as HTMLInputElement;
const createRoleSelect = document.getElementById('create-agent-role') as HTMLSelectElement;

createAgentBtn.addEventListener('click', () => {
  createNameInput.value = '';
  createRoleSelect.value = 'neutral';
  createAgentModal.classList.add('visible');
  createNameInput.focus();
});

createCancelBtn.addEventListener('click', () => {
  createAgentModal.classList.remove('visible');
});

createConfirmBtn.addEventListener('click', async () => {
  const name = createNameInput.value.trim();
  if (!name) return;
  const role = createRoleSelect.value;
  createAgentModal.classList.remove('visible');
  await sendMsg({ type: 'createAgent', name, role });
  await loadAgents();
});

createAgentModal.addEventListener('click', (e) => {
  if (e.target === createAgentModal) createAgentModal.classList.remove('visible');
});

// ══════════════════════════════════════════
// ── Tasks Tab
// ══════════════════════════════════════════

async function loadTasks(): Promise<void> {
  const result = await sendMsg<{ tasks: Task[] }>({ type: 'getTaskState' });
  tasks = result.tasks;
  renderTasks();
}

function renderTasks(): void {
  const tbody = document.getElementById('tasks-tbody')!;
  const empty = document.getElementById('tasks-empty')!;
  const table = document.getElementById('tasks-table')!;

  // Apply filters
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

  // Click handler for task rows
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

// Task filters
document.getElementById('tasks-filter-agent')!.addEventListener('change', renderTasks);
document.getElementById('tasks-filter-status')!.addEventListener('change', renderTasks);

// Task detail close
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
  const result = await sendMsg<{ messages: AgentMessage[] }>({ type: 'getMessages' });
  messages = result.messages;
  renderMessages();
}

function renderMessages(): void {
  const list = document.getElementById('message-list')!;
  const empty = document.getElementById('messages-empty')!;

  // Apply filters
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

  // Auto-scroll to bottom
  list.scrollTop = list.scrollHeight;
}

// Message filters
document.getElementById('messages-filter-agent')!.addEventListener('change', renderMessages);
document.getElementById('messages-search')!.addEventListener('input', renderMessages);

// ══════════════════════════════════════════
// ── Artifacts Tab
// ══════════════════════════════════════════

async function loadArtifacts(): Promise<void> {
  const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
  artifacts = result.artifacts;
  renderArtifacts();
}

function renderArtifacts(): void {
  const grid = document.getElementById('artifact-grid')!;
  const empty = document.getElementById('artifacts-empty')!;

  // Apply filter
  const filterAgent = (document.getElementById('artifacts-filter-agent') as HTMLSelectElement).value;

  let filtered = artifacts;
  if (filterAgent) {
    filtered = filtered.filter((a) => a.agentId === filterAgent);
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
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

  // Click handlers
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

  // Try to read content from OPFS via background
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

// Artifacts filter
document.getElementById('artifacts-filter-agent')!.addEventListener('change', renderArtifacts);

// ══════════════════════════════════════════
// ── Settings Tab
// ══════════════════════════════════════════

async function loadSettings(): Promise<void> {
  const result = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
  const keys = result.keys;

  (document.getElementById('settings-key-anthropic') as HTMLInputElement).value =
    keys.anthropic || '';
  (document.getElementById('settings-key-google') as HTMLInputElement).value = keys.google || '';
  (document.getElementById('settings-key-openai') as HTMLInputElement).value = keys.openai || '';
  (document.getElementById('settings-key-openrouter') as HTMLInputElement).value =
    keys.openrouter || '';
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
  // For now, just acknowledge — settings stored locally in the dashboard
  alert('Preferences saved.');
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
    // Keep the first "All" option, remove the rest
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
  await loadAgents();
  populateAgentFilters();
}

init();
