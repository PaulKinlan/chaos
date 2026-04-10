/**
 * `<chaos-messages-view>` — Inter-agent messages view.
 *
 * Shows messages sent/received by the active agent with direction
 * filters and search.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';
import type { AgentMeta, AgentMessage } from '../../storage/types.js';

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

@customElement('chaos-messages-view')
export class ChaosMessagesView extends LitElement {
  createRenderRoot() { return this; }

  /** Currently selected agent ID — set by the parent. */
  @property({ type: String, attribute: 'active-agent-id' }) activeAgentId: string | null = null;

  /** List of all agents (for resolving names). */
  @property({ type: Array }) agents: AgentMeta[] = [];

  @state() private _messages: AgentMessage[] = [];
  @state() private _dirFilter = '';
  @state() private _searchText = '';
  @state() private _loading = false;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-messages-view] connected');
  }

  async refresh(): Promise<void> {
    console.log('[chaos-messages-view] refresh, activeAgentId=', this.activeAgentId);
    this._loading = true;
    try {
      const result = await sendMsg<{ messages: AgentMessage[] }>({ type: 'getMessages' });
      this._messages = result.messages;
    } catch (err) {
      console.error('[chaos-messages-view] Error loading messages:', err);
    } finally {
      this._loading = false;
    }
  }

  private _agentName(agentId: string): string {
    const agent = this.agents.find((a) => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  private get _filtered(): AgentMessage[] {
    const myAgentId = this.activeAgentId || '';
    let filtered = myAgentId
      ? this._messages.filter((m) => m.from === myAgentId || m.to === myAgentId || m.to === 'broadcast')
      : this._messages;

    if (this._dirFilter === 'sent') {
      filtered = filtered.filter((m) => m.from === myAgentId);
    } else if (this._dirFilter === 'received') {
      filtered = filtered.filter((m) => m.from !== myAgentId && (m.to === myAgentId || m.to === 'broadcast'));
    }

    const search = this._searchText.toLowerCase().trim();
    if (search) {
      filtered = filtered.filter((m) => m.body.toLowerCase().includes(search));
    }

    return filtered;
  }

  render() {
    const filtered = this._filtered;

    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2>Messages</h2>
        </div>
        <p style="font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--sp-4); line-height: 1.5;">
          Messages sent and received by this agent.
        </p>

        <div class="filter-bar">
          <select @change=${(e: Event) => { this._dirFilter = (e.target as HTMLSelectElement).value; }}>
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="received">Received</option>
          </select>
          <input type="text" placeholder="Search messages..."
            .value=${this._searchText}
            @input=${(e: Event) => { this._searchText = (e.target as HTMLInputElement).value; }}>
        </div>

        ${this._loading ? html`
          <div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>
        ` : nothing}

        ${filtered.length === 0 ? html`
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3>No messages</h3>
            <p>${this._messages.length === 0
              ? 'No messages yet. Messages appear when agents communicate with each other.'
              : 'No messages match the current filters.'}</p>
          </div>
        ` : html`
          <div class="message-list">
            ${filtered.map((m) => {
              const isSent = m.from === (this.activeAgentId || '');
              const otherAgent = isSent ? m.to : m.from;
              const otherName = otherAgent === 'broadcast' ? 'broadcast' : this._agentName(otherAgent);
              return html`
                <div class="msg-item${m.to === 'broadcast' ? ' broadcast' : ''}">
                  <div class="msg-item-header">
                    ${isSent
                      ? html`<span class="badge" style="background:var(--success-subtle);color:var(--success-text);font-size:10px;">Sent</span>`
                      : html`<span class="badge" style="background:var(--warning-subtle);color:var(--warning-text);font-size:10px;">Received</span>`
                    }
                    <span style="font-size:var(--text-xs);color:var(--text-secondary);">${isSent ? 'to' : 'from'}</span>
                    <span class="msg-to" style="font-weight:500;">${escapeHtml(otherName)}</span>
                    <span class="msg-time">${formatTime(m.timestamp)}</span>
                  </div>
                  <div class="msg-body">${escapeHtml(m.body)}</div>
                </div>
              `;
            })}
          </div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-messages-view': ChaosMessagesView;
  }
}
