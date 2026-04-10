/**
 * `<chaos-tasks-view>` — Jobs board, scheduled tasks, and task timeline.
 *
 * Shows agent filter + status filter, jobs board table (click to expand
 * detail), scheduled tasks section with Run Now/Cancel, and a task
 * timeline of chronological events.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta, AgentMessage, Task, TaskEvent, ScheduledTask } from '../../storage/types.js';
import { SignalWatcher } from '../../state/signal-watcher.js';
import {
  tasks as tasksSignal,
  scheduledTasks as scheduledTasksSignal,
  taskEvents as taskEventsSignal,
  messages as messagesSignal,
  agents as agentsSignal,
  refreshTasks,
  refreshMessages,
} from '../../state/app-state.js';

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

function statusBadgeClass(status: string): string {
  return `status-${status}`;
}

@customElement('chaos-tasks-view')
export class ChaosTasksView extends SignalWatcher(LitElement) {
  createRenderRoot() { return this; }

  protected watchSignals() { return [tasksSignal, scheduledTasksSignal, taskEventsSignal, messagesSignal, agentsSignal]; }

  @property({ type: Array }) agents: AgentMeta[] = [];
  @property({ type: String }) activeAgentId: string | null = null;

  @state() private _filterAgentId = '';
  @state() private _filterStatus = '';
  @state() private _loading = false;
  @state() private _detailTask: Task | null = null;
  @state() private _detailOpen = false;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-tasks-view] connected');
  }

  private _agentName(agentId: string): string {
    const allAgents = this.agents.length > 0 ? this.agents : agentsSignal.value;
    const agent = allAgents.find(a => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  private _taskSubject(taskId: string): string {
    const t = tasksSignal.value.find(task => task.id === taskId);
    return t ? t.subject : taskId;
  }

  async refresh(filterByAgentId?: string): Promise<void> {
    console.log('[chaos-tasks-view] refresh');
    if (filterByAgentId) {
      this._filterAgentId = filterByAgentId;
    }
    this._loading = true;
    try {
      await Promise.all([refreshTasks(), refreshMessages()]);
    } catch (err) {
      console.error('[chaos-tasks-view] Error loading tasks:', err);
    } finally {
      this._loading = false;
    }
  }

  private get _filteredTasks(): Task[] {
    let filtered = this._filterAgentId
      ? tasksSignal.value.filter(t => t.owner === this._filterAgentId)
      : tasksSignal.value;
    if (this._filterStatus) {
      filtered = filtered.filter(t => t.status === this._filterStatus);
    }
    return filtered;
  }

  private get _agentScheduled(): ScheduledTask[] {
    return this._filterAgentId
      ? scheduledTasksSignal.value.filter(t => t.agentId === this._filterAgentId)
      : [];
  }

  private _onAgentJump(agentId: string): void {
    this.dispatchEvent(new CustomEvent('agent-jump', {
      detail: { agentId, view: 'tasks' },
      bubbles: true,
      composed: true,
    }));
  }

  private async _cancelScheduledTask(alarmId: string): Promise<void> {
    await sendMsg({ type: 'cancelScheduledTask', alarmId });
    this.refresh();
  }

  private _runScheduledTask(task: ScheduledTask): void {
    this.dispatchEvent(new CustomEvent('run-scheduled-task', {
      detail: { task },
      bubbles: true,
      composed: true,
    }));
  }

  private _showTaskDetail(taskId: string): void {
    const task = tasksSignal.value.find(t => t.id === taskId);
    if (!task) return;
    this._detailTask = task;
    this._detailOpen = true;
  }

  private _closeDetail(): void {
    this._detailOpen = false;
    this._detailTask = null;
  }

  private async _deleteTask(taskId: string): Promise<void> {
    const overlay = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) return;

    titleEl.textContent = 'Delete Task';
    msgEl.textContent = 'Delete this task? This cannot be undone.';
    overlay.classList.add('visible');

    const cleanup = () => {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onOk = async () => {
      cleanup();
      await sendMsg({ type: 'deleteTask', taskId });
      await this.refresh();
    };

    const onCancel = () => cleanup();

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  }

  render() {
    const agentCollab = this._filteredTasks;
    const agentScheduled = this._agentScheduled;
    const noResults = agentCollab.length === 0 && agentScheduled.length === 0 && !this._filterStatus;

    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2>Jobs</h2>
        </div>
        <div class="filter-bar">
          <select .value=${this._filterAgentId} @change=${(e: Event) => { this._filterAgentId = (e.target as HTMLSelectElement).value; }}>
            <option value="">All agents</option>
            ${this.agents.map(a => html`
              <option value=${a.id}>${a.name}${a.master ? ' \u2605' : ''}</option>
            `)}
          </select>
          <select .value=${this._filterStatus} @change=${(e: Event) => { this._filterStatus = (e.target as HTMLSelectElement).value; }}>
            <option value="">All statuses</option>
            <option value="pending">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        ${this._loading ? html`
          <div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>
        ` : nothing}

        ${noResults && !this._loading ? html`
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>
            </div>
            <h3>No jobs yet</h3>
            <p>Jobs are work items posted to a shared board. You or any agent can post a job, and specialised agents will pick them up. Think of it like a Kanban board.</p>
          </div>
        ` : nothing}

        ${!noResults || this._filterStatus ? html`
          <div>
            ${this._renderAgentLinks()}
            ${this._renderJobsBoard(agentCollab)}
            ${agentScheduled.length > 0 ? this._renderScheduled(agentScheduled) : nothing}
            ${this._renderTimeline()}
          </div>
        ` : nothing}
      </div>

      ${this._renderDetailModal()}
    `;
  }

  private _renderAgentLinks() {
    if (this.agents.length === 0) return nothing;

    return html`
      <div style="margin-bottom:16px;">
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:6px;">Jump to agent tasks:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${this.agents.map(agent => {
            const count = tasksSignal.value.filter(t => t.owner === agent.id).length + scheduledTasksSignal.value.filter(t => t.agentId === agent.id).length;
            return html`
              <button class="btn btn-ghost btn-xs" style="font-size:var(--text-xs);" @click=${() => this._onAgentJump(agent.id)}>
                ${escapeHtml(agent.name)}${count > 0 ? ` (${count})` : ''}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private _renderJobsBoard(agentCollab: Task[]) {
    return html`
      <div class="tasks-section">
        <div class="tasks-section-header">
          <h3>Jobs Board</h3>
          <p class="tasks-section-subtitle">Work items posted to the shared board. Agents pick up jobs based on their specialisation.</p>
        </div>

        ${agentCollab.length === 0 ? html`
          <p class="tasks-section-empty">
            ${tasksSignal.value.filter(t => t.owner === this.activeAgentId).length === 0
              ? 'No collaborative tasks yet. These appear when agents create work items for each other.'
              : 'No tasks match the current filters.'}
          </p>
        ` : html`
          <table class="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Dependencies</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${agentCollab.map(t => html`
                <tr class="clickable" @click=${(e: Event) => {
                  if ((e.target as HTMLElement).closest('.delete-task-btn')) return;
                  this._showTaskDetail(t.id);
                }}>
                  <td>${escapeHtml(t.subject)}</td>
                  <td>${t.owner ? escapeHtml(this._agentName(t.owner)) : html`<span style="color:var(--text-muted)">Unassigned</span>`}</td>
                  <td><span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(t.status.replace('_', ' '))}</span></td>
                  <td>${t.blockedBy && t.blockedBy.length > 0 ? t.blockedBy.map(id => escapeHtml(this._taskSubject(id))).join(', ') : html`<span style="color:var(--text-muted)">None</span>`}</td>
                  <td class="col-time">${formatTime(t.createdAt)}</td>
                  <td class="col-time">${formatTime(t.updatedAt)}</td>
                  <td>
                    <button class="btn btn-ghost btn-xs delete-task-btn" title="Delete task" style="color:var(--text-muted);"
                      @click=${(e: Event) => { e.stopPropagation(); this._deleteTask(t.id); }}>&#x2715;</button>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  private _renderScheduled(agentScheduled: ScheduledTask[]) {
    return html`
      <div class="tasks-section">
        <div class="tasks-section-header">
          <h3>Scheduled Tasks</h3>
          <p class="tasks-section-subtitle">Recurring and one-shot tasks this agent runs automatically.</p>
        </div>
        ${agentScheduled.map(t => {
          const scheduleLabel = t.schedule.type === 'recurring'
            ? `Every ${formatDuration(t.schedule.periodInMinutes || 0)}`
            : 'One-shot';
          const runCount = t.runHistory?.length || 0;
          return html`
            <div class="scheduled-task-item">
              <div class="scheduled-task-info">
                <div class="task-desc">${escapeHtml(t.description)}</div>
                <div class="task-schedule-badge">
                  <span class="badge badge-info">${escapeHtml(scheduleLabel)}</span>
                  <span class="badge badge-active">Active</span>
                  ${runCount > 0 ? html`<span class="badge" style="background:var(--bg-surface);color:var(--text-secondary);">${runCount} runs</span>` : nothing}
                </div>
                <div class="task-prompt">${escapeHtml(t.prompt.slice(0, 120))}${t.prompt.length > 120 ? '...' : ''}</div>
                ${t.lastRunAt ? html`
                  <div class="task-last-run">Last run: ${formatTimeFull(t.lastRunAt)}${t.lastResult ? ` — ${escapeHtml(t.lastResult.slice(0, 80))}${t.lastResult.length > 80 ? '...' : ''}` : ''}</div>
                ` : html`<div style="font-size:12px;color:var(--text-muted);">Not run yet</div>`}
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn btn-ghost btn-sm" @click=${() => this._runScheduledTask(t)}>Run Now</button>
                <button class="btn btn-danger btn-sm" @click=${() => this._cancelScheduledTask(t.alarmId)}>Cancel</button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderTimeline() {
    interface TimelineEntry {
      timestamp: string;
      agentName: string;
      text: string;
      type: 'created' | 'updated' | 'deleted' | 'message';
    }

    const entries: TimelineEntry[] = [];

    for (const evt of taskEventsSignal.value) {
      const ownerName = evt.data.owner ? this._agentName(evt.data.owner) : 'System';
      const subject = evt.data.subject || this._taskSubject(evt.taskId);

      if (evt.type === 'created') {
        entries.push({ timestamp: evt.timestamp, agentName: ownerName, text: `Created task "${subject}"`, type: 'created' });
      } else if (evt.type === 'updated') {
        let detail = '';
        if (evt.data.status === 'in_progress') detail = `Started working on "${subject}" (in_progress)`;
        else if (evt.data.status === 'completed') {
          const resultPreview = evt.data.result ? ': ' + evt.data.result.slice(0, 80) : '';
          detail = `Completed "${subject}"${resultPreview}`;
        } else if (evt.data.status === 'failed') detail = `Failed on "${subject}"`;
        else if (evt.data.owner) detail = `Assigned "${subject}" to ${this._agentName(evt.data.owner)}`;
        else detail = `Updated "${subject}"`;
        entries.push({ timestamp: evt.timestamp, agentName: ownerName, text: detail, type: 'updated' });
      } else if (evt.type === 'deleted') {
        entries.push({ timestamp: evt.timestamp, agentName: ownerName, text: `Deleted task "${subject}"`, type: 'deleted' });
      }
    }

    for (const m of messagesSignal.value) {
      if (m.to !== 'broadcast') {
        const preview = m.body.length > 100 ? m.body.slice(0, 100) + '...' : m.body;
        entries.push({
          timestamp: m.timestamp,
          agentName: this._agentName(m.from),
          text: `${this._agentName(m.from)} \u2192 ${this._agentName(m.to)}: "${preview}"`,
          type: 'message',
        });
      }
    }

    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (entries.length === 0) return nothing;

    const visible = entries.slice(-50);

    const iconSvgs = {
      created: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
      updated: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
      deleted: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      message: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    };

    return html`
      <div class="tasks-section" style="margin-top:24px;">
        <div class="tasks-section-header">
          <h3>Task Timeline</h3>
          <p class="tasks-section-subtitle">Execution flow across agents.</p>
        </div>
        <div class="task-timeline">
          ${visible.map(entry => {
            const d = new Date(entry.timestamp);
            const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return html`
              <div class="timeline-entry timeline-${entry.type}">
                <span class="timeline-time">${dateStr} ${timeStr}</span>
                <span class="timeline-icon">${iconSvgs[entry.type]}</span>
                <span class="timeline-agent">${escapeHtml(entry.agentName)}</span>
                <span class="timeline-text">${entry.text}</span>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  private _renderDetailModal() {
    if (!this._detailOpen || !this._detailTask) return nothing;
    const task = this._detailTask;

    return html`
      <div class="modal-overlay task-detail-modal visible" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeDetail(); }}>
        <div class="modal">
          <button class="modal-close" @click=${() => this._closeDetail()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div>
            <h2>${escapeHtml(task.subject)}</h2>
            <div class="task-detail-field">
              <div class="task-detail-label">Status</div>
              <div class="task-detail-value"><span class="badge ${statusBadgeClass(task.status)}">${escapeHtml(task.status.replace('_', ' '))}</span></div>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Owner</div>
              <div class="task-detail-value">${task.owner ? escapeHtml(this._agentName(task.owner)) : 'Unassigned'}</div>
            </div>
            ${task.description ? html`
              <div class="task-detail-field">
                <div class="task-detail-label">Description</div>
                <div class="task-detail-value">${escapeHtml(task.description)}</div>
              </div>
            ` : nothing}
            ${task.result ? html`
              <div class="task-detail-field">
                <div class="task-detail-label">Result</div>
                <div class="task-detail-value">${escapeHtml(task.result)}</div>
              </div>
            ` : nothing}
            ${task.blockedBy && task.blockedBy.length > 0 ? html`
              <div class="task-detail-field">
                <div class="task-detail-label">Blocked By</div>
                <div class="task-detail-value">${task.blockedBy.map(id => escapeHtml(this._taskSubject(id))).join(', ')}</div>
              </div>
            ` : nothing}
            <div class="task-detail-field">
              <div class="task-detail-label">Created</div>
              <div class="task-detail-value">${formatTimeFull(task.createdAt)}</div>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Updated</div>
              <div class="task-detail-value">${formatTimeFull(task.updatedAt)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-tasks-view': ChaosTasksView;
  }
}
