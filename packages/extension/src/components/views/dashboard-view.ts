/**
 * `<chaos-dashboard-view>` — Dashboard home view.
 *
 * Shows pinned artifacts, AI suggestions, recent artifacts,
 * activity summary stats, and per-hook breakdown.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta, ArtifactMeta } from '../../storage/types.js';
import { artifacts as artifactsSignal, pinnedArtifacts, recentArtifacts, agents as agentsSignal, refreshArtifacts, usageSummary as usageSummarySignal, refreshUsage, type UsageSummaryData } from '../../state/app-state.js';
import { SignalWatcher } from '../../state/signal-watcher.js';

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

// ── Types ──

interface DashboardSuggestion {
  id: string;
  title: string;
  description: string;
  action: {
    type: 'chat' | 'dismiss';
    prompt?: string;
  };
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  dismissedAt?: string;
}

interface HookDetail {
  description: string;
  triggerCount: number;
}

function artifactTypeLabel(a: ArtifactMeta): string {
  if (a.type) return a.type;
  const ext = a.path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': case 'htm': return 'html';
    case 'md': case 'markdown': return 'markdown';
    case 'json': return 'json';
    case 'csv': return 'csv';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image';
    default: return 'text';
  }
}

function artifactTypeBadgeClass(type?: string): string {
  switch (type) {
    case 'html': case 'webpage': return 'badge-blue';
    case 'markdown': return 'badge-purple';
    case 'json': return 'badge-amber';
    case 'csv': return 'badge-green';
    case 'image': return 'badge-red';
    default: return 'badge-gray';
  }
}

@customElement('chaos-dashboard-view')
export class ChaosDashboardView extends SignalWatcher(LitElement) {
  createRenderRoot() { return this; }

  protected watchSignals() { return [pinnedArtifacts, recentArtifacts, agentsSignal, usageSummarySignal]; }

  @property({ type: Array }) agents: AgentMeta[] = [];
  @state() private _suggestions: DashboardSuggestion[] = [];
  @state() private _todayUsage: UsageSummaryData | null = null;
  @state() private _hookDetails: HookDetail[] = [];
  @state() private _loading = false;
  @state() private _suggestionsGenerating = false;
  @state() private _refreshing = false;

  private _refreshTimer: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-dashboard-view] connected');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  private _agentName(agentId: string): string {
    const agent = this.agents.find(a => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  async refresh(): Promise<void> {
    console.log('[chaos-dashboard-view] refresh');
    this._loading = true;

    try {
      // Refresh artifacts signal — views re-render automatically via SignalWatcher
      await refreshArtifacts();
      const allArtifacts = artifactsSignal.value;

      // Load today's usage via signal
      try {
        // Dashboard always shows today's usage; fetch directly for today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const usageResult = await sendMsg<{ summary: UsageSummaryData }>({
          type: 'getUsageSummary',
          since: todayStart.toISOString(),
        });
        // Store in a local for dashboard's today-only view
        this._todayUsage = usageResult.summary || null;
        // Also refresh the global usage signal
        refreshUsage();
      } catch {
        // Usage unavailable
      }

      // Load suggestions
      await this._loadSuggestions(allArtifacts);

      // Load hooks info
      try {
        const hooksResult = await sendMsg<{ hooks: HookDetail[] }>({ type: 'getHooks' });
        this._hookDetails = (hooksResult.hooks || []).filter(h => h.triggerCount > 0).sort((a, b) => b.triggerCount - a.triggerCount);
      } catch {
        // Hooks unavailable
      }

      // Set up auto-refresh timer
      if (this._refreshTimer) clearInterval(this._refreshTimer);
      this._refreshTimer = window.setInterval(() => {
        this.refresh();
      }, 30000);
    } catch (err) {
      console.error('[chaos-dashboard-view] Error loading dashboard:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadSuggestions(allArtifacts: ArtifactMeta[]): Promise<void> {
    try {
      const suggestionsArtifact = allArtifacts.find(a => a.path.includes('suggestions/latest.json'));
      let suggestionsContent: string | null = null;

      if (suggestionsArtifact) {
        try {
          const result = await sendMsg<{ content: string }>({
            type: 'readArtifactContent',
            path: suggestionsArtifact.path,
          });
          if (result?.content) suggestionsContent = result.content;
        } catch { /* artifact read failed */ }
      }

      // Fallback: read directly from master agent's memory
      if (!suggestionsContent) {
        const masterAgent = this.agents.find(a => a.master);
        if (masterAgent) {
          for (const path of [
            `agents/${masterAgent.id}/suggestions/latest.json`,
            `shared/artifacts/${masterAgent.id}/suggestions/latest.json`,
          ]) {
            try {
              const result = await sendMsg<{ content: string }>({
                type: 'readArtifactContent',
                path,
              });
              if (result?.content && result.content.startsWith('[')) {
                suggestionsContent = result.content;
                break;
              }
            } catch { /* try next path */ }
          }
        }
      }

      if (suggestionsContent) {
        const parsed = JSON.parse(suggestionsContent);
        this._suggestions = (Array.isArray(parsed) ? parsed : []).filter((s: DashboardSuggestion) => !s.dismissedAt);
        console.log(`[chaos-dashboard-view] Loaded ${this._suggestions.length} suggestions`);
      } else {
        console.log('[chaos-dashboard-view] No suggestions file found — triggering generation');
        this._triggerSuggestionGeneration();
      }
    } catch (err) {
      console.warn('[chaos-dashboard-view] Failed to load suggestions:', err);
    }
  }

  private _triggerSuggestionGeneration(): void {
    if (this._suggestionsGenerating) return;
    const masterAgent = this.agents.find(a => a.master);
    if (!masterAgent) return;

    this._suggestionsGenerating = true;
    console.log('[chaos-dashboard-view] Triggering suggestion generation...');

    try {
      sendPortMessage({
        type: 'agenticChat',
        agentId: masterAgent.id,
        columnId: `suggestions-${Date.now()}`,
        message: `Generate personalized suggestions. Gather context from these sources:

1. Use tab_list to see what tabs I have open right now
2. Use history_search with an empty query to see my recent browsing (last few hours)
3. Use bookmark_search or bookmark_list to see recent bookmarks
4. Read my activity-log.jsonl, TODO.md, and memories/ for ongoing tasks

Then write a file at suggestions/latest.json containing a JSON array of 3-5 suggestions. Mix these types:
- Productivity: help me finish something I started (based on open tabs, TODOs, history patterns)
- Research: dive deeper into topics I've been browsing
- Organization: summarize, compare, or group things I've been looking at
- Fun/Discovery: something interesting related to my browsing that I might enjoy

Each suggestion object must have these fields:
- "id": unique string like "sug-1"
- "title": short title (5-8 words)
- "description": 1-2 sentence description explaining why this is relevant to ME right now
- "action": { "type": "chat", "prompt": "the exact prompt to send" }
- "priority": "high", "medium", or "low"
- "createdAt": "${new Date().toISOString()}"

Write the JSON array directly to suggestions/latest.json using write_file. Do not use artifact_publish. Just write the file and stop.`,
      });

      // Wait a bit then refresh to pick up the new suggestions
      setTimeout(() => {
        this._suggestionsGenerating = false;
        this.refresh();
      }, 15000);
    } catch {
      this._suggestionsGenerating = false;
    }
  }

  private _onRefreshClick(): void {
    this._refreshing = true;
    this.refresh().finally(() => {
      this._refreshing = false;
    });
  }

  private _onDoSuggestion(idx: number): void {
    const suggestion = this._suggestions[idx];
    if (suggestion.action?.prompt) {
      this.dispatchEvent(new CustomEvent('view-change', {
        detail: { view: 'chat', prompt: suggestion.action.prompt },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private async _onDismissSuggestion(idx: number): Promise<void> {
    this._suggestions[idx].dismissedAt = new Date().toISOString();

    // Persist the dismissed state back to the suggestions file
    const masterAgent = this.agents.find(a => a.master);
    if (masterAgent) {
      try {
        const allSuggestions = [...this._suggestions]; // includes dismissed
        await sendMsg({
          type: 'writeAgentFile',
          agentId: masterAgent.id,
          path: 'suggestions/latest.json',
          content: JSON.stringify(allSuggestions, null, 2),
        });
        console.log('[dashboard] Dismissed suggestion persisted');
      } catch (err) {
        console.warn('[dashboard] Failed to persist dismissed suggestion:', err);
      }
    }

    // Remove from visible list
    this._suggestions = this._suggestions.filter(s => !s.dismissedAt);
  }

  private _onViewArtifact(artifact: ArtifactMeta): void {
    this.dispatchEvent(new CustomEvent('show-artifact-detail', {
      detail: { artifact },
      bubbles: true,
      composed: true,
    }));
  }

  private _onChatAboutArtifact(artifact: ArtifactMeta): void {
    const displayName = artifact.title || artifact.path.split('/').pop() || artifact.path;
    this.dispatchEvent(new CustomEvent('view-change', {
      detail: {
        view: 'chat',
        prompt: `Read the artifact "${displayName}" at ${artifact.path} and discuss it with me. What are the key points?`,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private _onRecentClick(artifact: ArtifactMeta): void {
    this._onViewArtifact(artifact);
  }

  render() {
    const pinSvg = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>`;
    const artifactSvg = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;

    return html`
      <div class="view-padded">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h2>Dashboard</h2>
          <button class="btn btn-sm" ?disabled=${this._refreshing} @click=${() => this._onRefreshClick()}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            ${this._refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        ${this._loading ? html`
          <div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>
        ` : nothing}

        ${this._renderPinned(pinSvg)}
        ${this._renderSuggestions()}
        ${this._renderRecent(artifactSvg)}
        ${this._renderActivity()}
      </div>
    `;
  }

  private _renderPinned(pinSvg: unknown) {
    const pinned = pinnedArtifacts.value;
    const todayStr = new Date().toISOString().slice(0, 10);
    const hasToday = pinned.some(a => a.timestamp.startsWith(todayStr));
    const sectionTitle = pinned.length > 0 && hasToday ? 'Today' : pinned.length > 0 ? 'Pinned Artifacts' : 'Today';

    return html`
      <div class="dashboard-section">
        <div class="dashboard-section-title">${sectionTitle}</div>
        <div class="dashboard-cards">
          ${pinned.length > 0 ? pinned.map((a) => {
            const displayName = a.title || a.path.split('/').pop() || a.path;
            const typeLabel = artifactTypeLabel(a);
            return html`
              <div class="dashboard-card" style="cursor:pointer;" @click=${() => this._onViewArtifact(a)}>
                <div style="display:flex;align-items:center;gap:var(--sp-1);margin-bottom:var(--sp-1);">
                  <span class="pin-indicator">${pinSvg}</span>
                  <span class="badge ${artifactTypeBadgeClass(typeLabel)}" style="font-size:10px;">${escapeHtml(typeLabel)}</span>
                </div>
                <div class="dashboard-card-title">${escapeHtml(displayName)}</div>
                <div class="dashboard-card-desc">${escapeHtml(a.description)}</div>
                <div class="dashboard-card-meta">${escapeHtml(this._agentName(a.agentId))} &middot; ${formatTime(a.timestamp)}</div>
                <div class="dashboard-card-actions">
                  <button class="btn btn-ghost btn-xs" @click=${(e: Event) => { e.stopPropagation(); this._onViewArtifact(a); }}>View</button>
                  <button class="btn btn-ghost btn-xs" @click=${(e: Event) => { e.stopPropagation(); this._onChatAboutArtifact(a); }}>Chat about this</button>
                </div>
              </div>`;
          }) : html`
            <div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--sp-3);border:1px dashed var(--border-subtle);border-radius:6px;text-align:center;">
              No pinned artifacts yet. Pin an artifact from the Artifacts view, or ask your agent to create a daily summary.
            </div>
          `}
        </div>
      </div>
    `;
  }

  private _renderSuggestions() {
    const suggestions = this._suggestions;
    const lightbulbSvg = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`;

    return html`
      <div class="dashboard-section">
        <div class="dashboard-section-title">Suggestions</div>
        <div class="dashboard-cards">
          ${suggestions.length > 0 ? suggestions.map((s, i) => html`
            <div class="dashboard-card">
              <div style="display:flex;align-items:center;gap:var(--sp-1);margin-bottom:var(--sp-1);color:var(--text-muted);">
                ${lightbulbSvg}
                <span class="badge ${s.priority === 'high' ? 'badge-red' : s.priority === 'medium' ? 'badge-amber' : 'badge-gray'}" style="font-size:10px;">${escapeHtml(s.priority)}</span>
              </div>
              <div class="dashboard-card-title">${escapeHtml(s.title)}</div>
              <div class="dashboard-card-desc">${escapeHtml(s.description)}</div>
              <div class="dashboard-card-actions">
                <button class="btn btn-primary btn-xs" @click=${() => this._onDoSuggestion(i)}>Do it</button>
                <button class="btn btn-ghost btn-xs" @click=${() => this._onDismissSuggestion(i)}>Dismiss</button>
              </div>
            </div>
          `) : html`
            <div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--sp-3);border:1px dashed var(--border-subtle);border-radius:6px;text-align:center;">
              ${this._suggestionsGenerating ? html`
                <div class="spinner" style="width:16px;height:16px;margin:0 auto var(--sp-2);"></div>
                Generating suggestions based on your activity...
              ` : html`
                No suggestions yet.
                <button class="btn btn-sm btn-primary" @click=${() => this._triggerSuggestionGeneration()} style="margin-top:var(--sp-2);display:block;margin-left:auto;margin-right:auto;">Generate now</button>
              `}
            </div>
          `}
        </div>
      </div>
    `;
  }

  private _renderRecent(artifactSvg: unknown) {
    const recent = recentArtifacts.value;

    return html`
      <div class="dashboard-section">
        <div class="dashboard-section-title">Recent Artifacts</div>
        ${recent.length > 0 ? recent.map((a) => {
          const displayName = a.title || a.path.split('/').pop() || a.path;
          const typeLabel = artifactTypeLabel(a);
          return html`
            <div class="dashboard-recent-item" style="cursor:pointer;" @click=${() => this._onRecentClick(a)}>
              <span style="color:var(--text-muted);display:inline-flex;">${artifactSvg}</span>
              <span class="badge ${artifactTypeBadgeClass(typeLabel)}" style="font-size:10px;">${escapeHtml(typeLabel)}</span>
              <span class="dashboard-recent-item-name">${escapeHtml(displayName)}</span>
              <span class="dashboard-recent-item-time">${formatTime(a.timestamp)}</span>
            </div>`;
        }) : html`
          <div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--sp-3);border:1px dashed var(--border-subtle);border-radius:6px;text-align:center;">
            No artifacts yet. Ask your agent to research something or summarise a page — results will appear here.
          </div>
        `}
      </div>
    `;
  }

  private _renderActivity() {
    const usage = this._todayUsage;
    const hookDetails = this._hookDetails;
    const hooksCount = hookDetails.reduce((sum, h) => sum + h.triggerCount, 0);
    const totalTokens = usage ? usage.totalInputTokens + usage.totalOutputTokens : 0;
    const costStr = usage ? `$${usage.totalCost.toFixed(4)}` : '$0.00';
    const requestsStr = usage?.totalRequests?.toString() || '0';

    return html`
      <div class="dashboard-section">
        <div class="dashboard-section-title">Activity Summary</div>
        <div class="dashboard-activity">
          <div class="dashboard-activity-stat">
            <div class="dashboard-activity-value">${requestsStr}</div>
            <div class="dashboard-activity-label">Requests Today</div>
          </div>
          <div class="dashboard-activity-stat">
            <div class="dashboard-activity-value">${totalTokens.toLocaleString()}</div>
            <div class="dashboard-activity-label">Tokens Used</div>
          </div>
          <div class="dashboard-activity-stat">
            <div class="dashboard-activity-value">${costStr}</div>
            <div class="dashboard-activity-label">Cost Today</div>
          </div>
          <div class="dashboard-activity-stat">
            <div class="dashboard-activity-value">${hooksCount}</div>
            <div class="dashboard-activity-label">Hooks Fired</div>
          </div>
          ${hookDetails.length > 0 ? html`
            <div style="grid-column:1/-1;margin-top:var(--sp-2);font-size:var(--text-xs);color:var(--text-muted);">
              ${hookDetails.slice(0, 5).map(h => html`
                <div style="display:flex;justify-content:space-between;padding:2px 0;">
                  <span>${escapeHtml(h.description)}</span>
                  <span>${h.triggerCount}x</span>
                </div>
              `)}
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-dashboard-view': ChaosDashboardView;
  }
}
