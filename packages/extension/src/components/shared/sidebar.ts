import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { Signal } from '@preact/signals-core';
import { SignalWatcher } from '../../state/signal-watcher.js';
import { activeView, agents, activeAgentId } from '../../state/app-state.js';
import type { AgentMeta } from '../../storage/types.js';

/**
 * <chaos-sidebar> — Main navigation sidebar.
 *
 * Reads from signals: activeView, agents, activeAgentId.
 * Fires events: view-change, agent-change, create-agent.
 * Uses Light DOM so existing CSS classes apply.
 */
@customElement('chaos-sidebar')
export class ChaosSidebar extends SignalWatcher(LitElement) {
  createRenderRoot() { return this; }

  protected watchSignals(): Signal<unknown>[] {
    return [activeView, agents, activeAgentId];
  }

  render() {
    const view = activeView.value;
    const agentList = agents.value.filter(a => a.role !== 'archived');
    const currentAgentId = activeAgentId.value;

    return html`
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-nav">
          ${this._renderNavItem('dashboard', 'Dashboard', 'dashboard', view)}
          ${this._renderNavItem('chat', 'Chat', 'chat', view)}
          ${this._renderNavItem('tasks', 'Jobs', 'tasks', view)}
          ${this._renderNavItem('artifacts', 'Artifacts', 'artifacts', view)}
          ${this._renderNavItem('channels', 'Channels', 'channels', view)}
          ${this._renderNavItem('hooks', 'Hooks', 'hooks', view)}
          ${this._renderNavItem('usage', 'Usage', 'usage', view)}

          <div class="sidebar-divider"></div>
          <div class="sidebar-section-label" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Agents</span>
            <button id="btn-add-agent-sidebar" title="Create new agent"
                    style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0;line-height:1;"
                    @click=${this._onCreateAgent}>
              <chaos-icon name="plus" size="14"></chaos-icon>
            </button>
          </div>
          <div id="sidebar-agent-list">
            ${agentList.map(agent => this._renderAgent(agent, currentAgentId))}
          </div>
        </div>
        <div class="sidebar-bottom">
          ${this._renderNavItem('global-settings', 'Settings', 'settings', view)}
        </div>
      </nav>
    `;
  }

  private _renderNavItem(viewName: string, label: string, iconName: string, currentView: string) {
    const isActive = currentView === viewName;
    return html`
      <button class="sidebar-item ${isActive ? 'active' : ''}"
              data-view=${viewName}
              @click=${() => this._switchView(viewName)}>
        <chaos-icon name=${iconName} size="16"></chaos-icon>
        <span class="label">${label}</span>
      </button>
    `;
  }

  private _renderAgent(agent: AgentMeta, currentAgentId: string | null) {
    const isActive = agent.id === currentAgentId;
    const view = activeView.value;
    return html`
      <details class="sidebar-agent-details" ?open=${isActive} data-agent-id=${agent.id}>
        <summary class="sidebar-agent-item ${isActive ? 'active' : ''}"
                 @dblclick=${() => this._switchToAgentChat(agent.id)}>
          <span>${agent.name}</span>
        </summary>
        <div class="sidebar-agent-sub">
          <button class="sidebar-item ${isActive && view === 'files' ? 'active' : ''}"
                  @click=${() => this._switchToAgentView(agent.id, 'files')}>
            <chaos-icon name="memory" size="14"></chaos-icon>
            <span class="label">Memory</span>
          </button>
          <button class="sidebar-item ${isActive && view === 'agent-settings' ? 'active' : ''}"
                  @click=${() => this._switchToAgentView(agent.id, 'agent-settings')}>
            <chaos-icon name="edit" size="14"></chaos-icon>
            <span class="label">Settings</span>
          </button>
          <button class="sidebar-item ${isActive && view === 'tasks' ? 'active' : ''}"
                  @click=${() => this._switchToAgentView(agent.id, 'tasks')}>
            <chaos-icon name="tasks" size="14"></chaos-icon>
            <span class="label">Jobs</span>
          </button>
          <button class="sidebar-item ${isActive && view === 'messages' ? 'active' : ''}"
                  @click=${() => this._switchToAgentView(agent.id, 'messages')}>
            <chaos-icon name="chat" size="14"></chaos-icon>
            <span class="label">Messages</span>
          </button>
        </div>
      </details>
    `;
  }

  private _onCreateAgent() {
    this.dispatchEvent(new CustomEvent('create-agent', { bubbles: true }));
  }

  private _switchView(viewName: string) {
    activeView.value = viewName;
    this.dispatchEvent(new CustomEvent('view-change', { detail: viewName, bubbles: true }));
  }

  private _switchToAgentChat(agentId: string) {
    activeAgentId.value = agentId;
    activeView.value = 'chat';
    this.dispatchEvent(new CustomEvent('agent-change', { detail: agentId, bubbles: true }));
  }

  private _switchToAgentView(agentId: string, viewName: string) {
    activeAgentId.value = agentId;
    activeView.value = viewName;
    this.dispatchEvent(new CustomEvent('agent-change', { detail: agentId, bubbles: true }));
    this.dispatchEvent(new CustomEvent('view-change', { detail: viewName, bubbles: true }));
  }
}
