/**
 * `<chaos-usage-view>` — Usage & Costs dashboard view.
 *
 * Shows time-range selector, stat cards, provider/agent breakdowns,
 * recent requests table, and global spending alert configuration.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getUsageSince(range: string): string | undefined {
  const now = Date.now();
  switch (range) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return undefined;
  }
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '$' + cost.toFixed(4);
  if (cost < 1) return '$' + cost.toFixed(3);
  return '$' + cost.toFixed(2);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function usageAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ── Types ──

interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byAgent: Record<string, { name: string; cost: number; inputTokens: number; outputTokens: number; requests: number }>;
}

interface UsageRecord {
  timestamp: string;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  source: string;
}

interface SpendingLimitResult {
  limit: number | null;
}

@customElement('chaos-usage-view')
export class ChaosUsageView extends LitElement {
  createRenderRoot() { return this; }

  @state() private _range = '7d';
  @state() private _summary: UsageSummary | null = null;
  @state() private _records: UsageRecord[] = [];
  @state() private _loading = false;
  @state() private _alertLimit: number | null = null;
  @state() private _alertStatus = '';
  @state() private _alertWarning = '';
  @state() private _alertWarningStyle = '';

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-usage-view] connected');
  }

  async refresh(): Promise<void> {
    console.log('[chaos-usage-view] refresh, range=', this._range);
    this._loading = true;

    try {
      const since = getUsageSince(this._range);

      const [summaryResult, recordsResult] = await Promise.all([
        sendMsg<{ summary: UsageSummary }>({ type: 'getUsageSummary', since }),
        sendMsg<{ records: UsageRecord[] }>({ type: 'getUsageRecords', since, limit: 50 }),
      ]);

      if (!summaryResult || !recordsResult) return;
      this._summary = summaryResult.summary;
      this._records = recordsResult.records;

      // Load global alert
      await this._loadGlobalAlert();
      await this._checkGlobalAlert();
    } catch (err) {
      console.error('[chaos-usage-view] Error loading usage:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadGlobalAlert(): Promise<void> {
    try {
      const result = await sendMsg<SpendingLimitResult>({ type: 'getAgentSpendingLimit', agentId: '__global__' });
      if (result?.limit !== null && result?.limit !== undefined) {
        this._alertLimit = result.limit;
        this._alertStatus = 'Active';
      } else {
        this._alertLimit = null;
        this._alertStatus = 'Not set';
      }
    } catch (err) {
      console.error('[chaos-usage-view] Error loading global alert:', err);
    }
  }

  private async _checkGlobalAlert(): Promise<void> {
    try {
      const result = await sendMsg<SpendingLimitResult>({ type: 'getAgentSpendingLimit', agentId: '__global__' });
      if (!result?.limit) {
        this._alertWarning = '';
        return;
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const summaryResult = await sendMsg<{ summary: { totalCost: number } }>({ type: 'getUsageSummary', since: todayStart.toISOString() });
      const spent = summaryResult?.summary?.totalCost || 0;

      if (spent >= result.limit) {
        this._alertWarning = `Daily spending alert: you've spent ${formatCost(spent)} today, exceeding your ${formatCost(result.limit)} limit.`;
        this._alertWarningStyle = 'background:var(--danger-subtle);color:var(--danger-text);';
      } else if (spent >= result.limit * 0.8) {
        this._alertWarning = `Approaching daily limit: ${formatCost(spent)} of ${formatCost(result.limit)} (${Math.round(spent / result.limit * 100)}%)`;
        this._alertWarningStyle = 'background:var(--warning-subtle, #3a3a1a);color:var(--warning-text, #d29922);';
      } else {
        this._alertWarning = '';
      }
    } catch (err) {
      console.error('[chaos-usage-view] Error checking global alert:', err);
    }
  }

  private async _saveAlert(): Promise<void> {
    const input = this.querySelector('#chaos-usage-alert-input') as HTMLInputElement;
    const val = input?.value ? parseFloat(input.value) : null;
    try {
      await sendMsg({ type: 'setAgentSpendingLimit', agentId: '__global__', limit: val });
      this._alertLimit = val;
      this._alertStatus = val !== null ? 'Saved!' : 'Cleared';
      setTimeout(() => {
        this._alertStatus = val !== null ? 'Active' : 'Not set';
      }, 1500);
      await this._checkGlobalAlert();
    } catch (err) {
      console.error('[chaos-usage-view] Error saving alert:', err);
    }
  }

  private async _clearUsage(): Promise<void> {
    // Create a confirmation dialog
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div style="padding:20px;max-width:320px;">
        <h3 style="margin-bottom:12px;">Clear usage data?</h3>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:16px;">This will delete all recorded usage data. This cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn" id="usage-clear-cancel-dlg">Cancel</button>
          <button class="btn btn-danger" id="usage-clear-confirm-dlg">Clear</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#usage-clear-cancel-dlg')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#usage-clear-confirm-dlg')?.addEventListener('click', async () => {
      await sendMsg({ type: 'clearUsage' });
      dlg.close();
      dlg.remove();
      this.refresh();
    });
  }

  private _onRangeChange(e: Event): void {
    this._range = (e.target as HTMLSelectElement).value;
    this.refresh();
  }

  render() {
    const summary = this._summary;

    return html`
      <div class="view-padded">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h2>Usage &amp; Costs</h2>
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <select class="settings-select" style="padding:4px 8px;font-size:var(--text-xs);"
              .value=${this._range}
              @change=${this._onRangeChange}>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            <button class="btn btn-sm" @click=${() => this.refresh()}>Refresh</button>
            <button class="btn btn-sm btn-danger" @click=${() => this._clearUsage()}>Clear</button>
          </div>
        </div>

        <!-- Global Spending Alert -->
        <div style="margin-top:var(--sp-3);padding:var(--sp-3);background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;">
          <div style="display:flex;align-items:center;gap:var(--sp-2);font-size:var(--text-sm);">
            <span style="color:var(--text-secondary);font-weight:500;">Daily spending alert:</span>
            <span style="color:var(--text-primary);">$</span>
            <input type="number" id="chaos-usage-alert-input" min="0" step="0.5" placeholder="none"
              .value=${this._alertLimit !== null ? String(this._alertLimit) : ''}
              style="width:80px;padding:2px 6px;font-size:var(--text-sm);background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);">
            <button class="btn btn-sm" @click=${() => this._saveAlert()}>Save</button>
            <span style="font-size:var(--text-xs);color:var(--text-muted);">${this._alertStatus}</span>
          </div>
          ${this._alertWarning ? html`
            <div style="margin-top:var(--sp-2);padding:var(--sp-2);border-radius:4px;font-size:var(--text-xs);${this._alertWarningStyle}">
              ${this._alertWarning}
            </div>
          ` : nothing}
        </div>

        ${this._loading ? html`
          <div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>
        ` : nothing}

        ${summary ? this._renderStats(summary) : nothing}
        ${summary ? this._renderProviders(summary) : nothing}
        ${summary ? this._renderAgents(summary) : nothing}
        ${this._renderRecent()}
      </div>
    `;
  }

  private _renderStats(summary: UsageSummary) {
    return html`
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--sp-3);margin:var(--sp-4) 0;">
        <div class="usage-stat-card">
          <div class="usage-stat-value">${formatCost(summary.totalCost)}</div>
          <div class="usage-stat-label">Estimated Cost</div>
        </div>
        <div class="usage-stat-card">
          <div class="usage-stat-value">${formatTokens(summary.totalInputTokens)}</div>
          <div class="usage-stat-label">Input Tokens</div>
        </div>
        <div class="usage-stat-card">
          <div class="usage-stat-value">${formatTokens(summary.totalOutputTokens)}</div>
          <div class="usage-stat-label">Output Tokens</div>
        </div>
        <div class="usage-stat-card">
          <div class="usage-stat-value">${summary.totalRequests}</div>
          <div class="usage-stat-label">Requests</div>
        </div>
      </div>
    `;
  }

  private _renderProviders(summary: UsageSummary) {
    const providers = Object.entries(summary.byProvider).sort((a, b) => b[1].cost - a[1].cost);
    const maxCost = providers.length > 0 ? providers[0][1].cost : 1;

    return html`
      <div style="margin-bottom:var(--sp-4);">
        <h3 style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--sp-2);">By Provider</h3>
        ${providers.length === 0
          ? html`<div style="color:var(--text-muted);font-size:var(--text-sm);padding:var(--sp-2) 0;">No data yet</div>`
          : providers.map(([name, data]) => html`
            <div class="usage-bar-row">
              <span class="usage-bar-label">${escapeHtml(name)}</span>
              <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${maxCost > 0 ? (data.cost / maxCost * 100) : 0}%"></div></div>
              <span class="usage-bar-value">${formatCost(data.cost)} (${data.requests})</span>
            </div>
          `)
        }
      </div>
    `;
  }

  private _renderAgents(summary: UsageSummary) {
    const agents = Object.entries(summary.byAgent).sort((a, b) => b[1].cost - a[1].cost);
    const maxCost = agents.length > 0 ? agents[0][1].cost : 1;

    return html`
      <div style="margin-bottom:var(--sp-4);">
        <h3 style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--sp-2);">By Agent</h3>
        ${agents.length === 0
          ? html`<div style="color:var(--text-muted);font-size:var(--text-sm);padding:var(--sp-2) 0;">No data yet</div>`
          : agents.map(([, data]) => html`
            <div class="usage-bar-row">
              <span class="usage-bar-label">${escapeHtml(data.name)}</span>
              <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${maxCost > 0 ? (data.cost / maxCost * 100) : 0}%"></div></div>
              <span class="usage-bar-value">${formatCost(data.cost)} (${data.requests})</span>
            </div>
          `)
        }
      </div>
    `;
  }

  private _renderRecent() {
    const records = this._records;

    return html`
      <div>
        <h3 style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--sp-2);">Recent Requests</h3>
        <div style="max-height:400px;overflow-y:auto;">
          ${records.length === 0
            ? html`<div style="color:var(--text-muted);font-size:var(--text-sm);padding:var(--sp-2) 0;">No requests recorded yet. Start chatting with an agent to see usage data.</div>`
            : records.map((r) => html`
              <div class="usage-request-row">
                <span style="color:var(--text-muted);min-width:60px;" title=${new Date(r.timestamp).toLocaleString()}>${usageAgo(r.timestamp)}</span>
                <span style="color:var(--text-secondary);min-width:100px;font-weight:500;">${escapeHtml(r.agentName)}</span>
                <span style="color:var(--text-muted);min-width:60px;">${escapeHtml(r.provider)}</span>
                <span style="color:var(--text-muted);min-width:120px;font-family:var(--font-mono);">${escapeHtml(r.model)}</span>
                <span style="color:var(--text-muted);font-family:var(--font-mono);">${formatTokens(r.inputTokens)}/${formatTokens(r.outputTokens)}</span>
                <span style="color:var(--text-primary);font-family:var(--font-mono);min-width:60px;text-align:right;">${formatCost(r.estimatedCost)}</span>
                <span style="color:var(--text-muted);font-size:10px;text-transform:uppercase;">${r.source}</span>
              </div>
            `)
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-usage-view': ChaosUsageView;
  }
}
