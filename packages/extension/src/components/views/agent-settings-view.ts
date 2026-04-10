/**
 * `<chaos-agent-settings-view>` — Per-agent settings view.
 *
 * Name, visibility, model config, tools, skills, CLAUDE.md editor,
 * per-agent usage, spending limits, and danger zone.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta } from '../../storage/types.js';
import { toolRegistry } from '../../tools/lookup/registry.js';
import type { ToolMeta } from '../../tools/lookup/types.js';
import { getFallbackModels, listProviders } from '../../agents/provider-registry.js';
import { FEATURED_SKILLS } from '../../agents/featured-skills.js';

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeFull(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function roleBadgeClass(role: string): string {
  if (role === 'orchestrator') return 'badge badge-purple';
  return 'badge badge-neutral';
}

function visBadgeClass(vis: string): string {
  if (vis === 'open') return 'badge badge-green';
  if (vis === 'visible') return 'badge badge-blue';
  return 'badge badge-neutral';
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

interface SkillMetaUI {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  source?: string;
  installedAt: string;
  files: string[];
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

const MINIMUM_TOOLS = ['read_file', 'list_directory'];

@customElement('chaos-agent-settings-view')
export class ChaosAgentSettingsView extends LitElement {
  createRenderRoot() { return this; }

  @property() activeAgentId: string | null = null;

  @state() private _meta: AgentMeta | null = null;
  @state() private _claudeMd = '';
  @state() private _loading = false;
  @state() private _error = '';

  // Model config
  @state() private _globalSettings: { activeProvider: string; model?: string } = { activeProvider: 'anthropic' };
  @state() private _selectedProvider = '';
  @state() private _selectedModel = '';
  @state() private _customModel = '';
  @state() private _apiKeyMode: 'global' | 'custom' = 'global';
  @state() private _hasExistingApiKey = false;

  // Tools
  @state() private _disabledTools: Set<string> = new Set();

  // Skills
  @state() private _skills: SkillMetaUI[] = [];
  @state() private _showSkillBrowser = false;
  @state() private _skillUrl = '';
  @state() private _skillImportStatus = '';
  @state() private _skillPreview: { meta: { name: string; description: string; author?: string; version?: string }; preview: string; fileCount: number; files: string[] } | null = null;
  @state() private _pendingSkillUrl = '';
  @state() private _manualSkillName = '';
  @state() private _manualSkillDesc = '';
  @state() private _manualSkillContent = '';

  // Usage
  @state() private _usageRange = '7d';
  @state() private _usageRecords: UsageRecord[] = [];
  @state() private _usageCost = 0;

  // Spending
  @state() private _spendingLimit: number | null = null;
  @state() private _spendingLimitDisplay = 'none';

  // Status messages
  @state() private _nameStatus = '';
  @state() private _modelStatus = '';
  @state() private _toolsStatus = '';
  @state() private _claudeMdStatus = '';
  @state() private _limitStatus = '';

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-agent-settings-view] connected');
  }

  async refresh(): Promise<void> {
    if (!this.activeAgentId) {
      this._meta = null;
      this._error = '';
      return;
    }

    console.log('[chaos-agent-settings-view] refresh for', this.activeAgentId);
    this._loading = true;
    this._error = '';

    try {
      const result = await sendMsg<{
        claudeMd: string;
        journal: string[];
        bookmarks: string[];
        meta: AgentMeta;
      }>({ type: 'getAgentDetail', agentId: this.activeAgentId });

      const meta = result?.meta;
      if (!meta) {
        this._error = 'Could not load agent settings. The agent may have been removed.';
        this._loading = false;
        return;
      }
      this._meta = meta;
      this._claudeMd = result.claudeMd || '';

      // Load global settings
      try {
        const sr = await sendMsg<{ settings: { activeProvider: string; model?: string } }>({ type: 'getSettings' });
        this._globalSettings = sr.settings;
      } catch { /* use defaults */ }

      // Set model config from agent meta
      this._selectedProvider = meta.provider || '';
      this._selectedModel = '';
      this._customModel = '';
      if (meta.model) {
        const models = getFallbackModels(meta.provider || this._globalSettings.activeProvider);
        const inList = models.some(m => m.value === meta.model);
        if (inList) {
          this._selectedModel = meta.model!;
        } else {
          this._customModel = meta.model!;
        }
      }

      // Check per-agent API key
      const agentKeyStorageKey = `chaos:agentApiKey:${meta.id}`;
      const keyResult = await chrome.storage.local.get(agentKeyStorageKey);
      const existingKey = keyResult[agentKeyStorageKey] as string | undefined;
      this._apiKeyMode = existingKey ? 'custom' : 'global';
      this._hasExistingApiKey = !!existingKey;

      // Load disabled tools
      this._disabledTools = new Set<string>(meta.disabledTools ?? []);

      // Load skills
      await this._loadSkills();

      // Load spending limit
      const limitResult = await sendMsg<{ limit: number | null }>({ type: 'getAgentSpendingLimit', agentId: meta.id });
      this._spendingLimit = limitResult?.limit ?? null;
      this._spendingLimitDisplay = this._spendingLimit !== null ? `$${this._spendingLimit}/day` : 'none';

      // Load usage
      await this._loadUsage();

    } catch (err) {
      this._error = `Failed to load agent settings: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._loading = false;
    }
  }

  private async _loadSkills(): Promise<void> {
    if (!this._meta) return;
    try {
      const result = await sendMsg<{ skills: SkillMetaUI[] }>({ type: 'listSkills', agentId: this._meta.id });
      this._skills = result.skills || [];
    } catch {
      this._skills = [];
    }
  }

  private async _loadUsage(): Promise<void> {
    if (!this._meta) return;
    const since = getUsageSince(this._usageRange);
    try {
      const recordsResult = await sendMsg<{ records: UsageRecord[] }>({ type: 'getUsageRecords', agentId: this._meta.id, since, limit: 30 });
      this._usageRecords = recordsResult?.records || [];
      this._usageCost = this._usageRecords.reduce((s, r) => s + r.estimatedCost, 0);
    } catch {
      this._usageRecords = [];
      this._usageCost = 0;
    }
  }

  // ── Actions ──

  private async _saveName(): Promise<void> {
    if (!this._meta) return;
    const input = this.querySelector('#agent-name-input') as HTMLInputElement;
    const newName = input?.value.trim();
    if (!newName) return;
    this._nameStatus = 'Saving...';
    await sendMsg({ type: 'updateAgentName', agentId: this._meta.id, name: newName });
    sendPortMessage({ type: 'listAgents' });
    this._nameStatus = 'Saved!';
    setTimeout(() => { this._nameStatus = ''; }, 2000);
  }

  private async _changeVisibility(e: Event): Promise<void> {
    if (!this._meta) return;
    const newVis = (e.target as HTMLSelectElement).value;
    await sendMsg({ type: 'updateAgentVisibility', agentId: this._meta.id, visibility: newVis });
    sendPortMessage({ type: 'listAgents' });
  }

  private async _saveModel(): Promise<void> {
    if (!this._meta) return;
    this._modelStatus = 'Saving...';
    const provider = this._selectedProvider || undefined;
    const model = this._customModel.trim() || this._selectedModel || undefined;
    await sendMsg({ type: 'updateAgentModel', agentId: this._meta.id, provider, model });

    // Save or clear per-agent API key
    const agentKeyStorageKey = `chaos:agentApiKey:${this._meta.id}`;
    if (this._apiKeyMode === 'custom') {
      const apiKeyInput = this.querySelector('#agent-apikey-input') as HTMLInputElement;
      if (apiKeyInput?.value.trim()) {
        await chrome.storage.local.set({ [agentKeyStorageKey]: apiKeyInput.value.trim() });
        this._hasExistingApiKey = true;
      }
    } else {
      await chrome.storage.local.remove(agentKeyStorageKey);
      this._hasExistingApiKey = false;
    }

    this._modelStatus = 'Saved!';
    setTimeout(() => { this._modelStatus = ''; }, 2000);
  }

  private async _saveTools(): Promise<void> {
    if (!this._meta) return;
    this._toolsStatus = 'Saving...';
    const checkboxes = this.querySelectorAll<HTMLInputElement>('input[data-tool-name]');
    const disabled: string[] = [];
    checkboxes.forEach((cb) => {
      if (!cb.checked && !MINIMUM_TOOLS.includes(cb.dataset.toolName!)) {
        disabled.push(cb.dataset.toolName!);
      }
    });
    await sendMsg({
      type: 'updateAgentTools',
      agentId: this._meta.id,
      disabledTools: disabled.length > 0 ? disabled : undefined,
      enabledTools: undefined,
    });
    this._toolsStatus = 'Saved!';
    setTimeout(() => { this._toolsStatus = ''; }, 2000);
  }

  private async _removeSkill(skillId: string): Promise<void> {
    if (!this._meta) return;
    try {
      await sendMsg({ type: 'removeSkill', agentId: this._meta.id, skillId });
      await this._loadSkills();
    } catch (err) {
      console.error('[agent-settings] Failed to remove skill:', err);
    }
  }

  private async _installManualSkill(): Promise<void> {
    if (!this._meta) return;
    if (!this._manualSkillContent.trim()) return;
    try {
      await sendMsg({
        type: 'installSkill',
        agentId: this._meta.id,
        name: this._manualSkillName || 'Unnamed Skill',
        description: this._manualSkillDesc || 'No description',
        content: this._manualSkillContent,
      });
      this._manualSkillName = '';
      this._manualSkillDesc = '';
      this._manualSkillContent = '';
      await this._loadSkills();
    } catch (err) {
      console.error('[agent-settings] Failed to install skill:', err);
    }
  }

  private async _importSkillFromUrl(): Promise<void> {
    if (!this._meta || !this._skillUrl.trim()) return;
    this._skillImportStatus = 'Fetching skill...';
    try {
      const result = await sendMsg<{
        meta: { name: string; description: string; author?: string; version?: string };
        preview: string;
        fileCount: number;
        files: string[];
      }>({ type: 'fetchSkillPreviewOneShot', url: this._skillUrl });
      if ('error' in result) throw new Error((result as unknown as { error: string }).error);
      this._pendingSkillUrl = this._skillUrl;
      this._skillPreview = result;
      this._skillImportStatus = '';
    } catch (err) {
      this._skillImportStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      this._skillPreview = null;
    }
  }

  private async _confirmSkillInstall(): Promise<void> {
    if (!this._meta || !this._pendingSkillUrl) return;
    this._skillImportStatus = 'Installing...';
    try {
      await sendMsg({ type: 'importSkillFromUrlOneShot', agentId: this._meta.id, url: this._pendingSkillUrl });
      this._skillPreview = null;
      this._skillUrl = '';
      this._pendingSkillUrl = '';
      this._skillImportStatus = '';
      await this._loadSkills();
    } catch (err) {
      this._skillImportStatus = `Install failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async _installFeaturedSkill(url: string, btn: HTMLButtonElement): Promise<void> {
    if (!this._meta) return;
    btn.textContent = 'Installing...';
    btn.disabled = true;
    try {
      await sendMsg({ type: 'importSkillFromUrlOneShot', agentId: this._meta.id, url });
      btn.textContent = 'Installed';
      await this._loadSkills();
    } catch (err) {
      btn.textContent = 'Failed';
      btn.disabled = false;
      console.error('[agent-settings] Featured skill install failed:', err);
    }
  }

  private async _saveClaudeMd(): Promise<void> {
    if (!this._meta) return;
    const textarea = this.querySelector('#agent-claude-md') as HTMLTextAreaElement;
    const content = textarea?.value || '';
    this._claudeMdStatus = 'Saving...';
    await sendMsg({ type: 'setClaudeMd', agentId: this._meta.id, content });
    this._claudeMdStatus = 'Saved!';
    setTimeout(() => { this._claudeMdStatus = ''; }, 2000);
  }

  private async _deleteAgent(): Promise<void> {
    if (!this._meta) return;
    const meta = this._meta;
    // Use imperative confirm dialog
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div style="padding:20px;max-width:320px;">
        <h3 style="margin-bottom:12px;">Delete Agent</h3>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:16px;">Are you sure you want to delete "${escapeHtml(meta.name)}"? This cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn" id="del-cancel">Cancel</button>
          <button class="btn btn-danger" id="del-confirm">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#del-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#del-confirm')?.addEventListener('click', async () => {
      await sendMsg({ type: 'deleteAgent', agentId: meta.id });
      dlg.close();
      dlg.remove();
      sendPortMessage({ type: 'listAgents' });
      this.dispatchEvent(new CustomEvent('agent-deleted', { bubbles: true, composed: true }));
    });
  }

  private async _saveSpendingLimit(): Promise<void> {
    if (!this._meta) return;
    const input = this.querySelector('#agent-daily-limit') as HTMLInputElement;
    const val = parseFloat(input?.value);
    if (isNaN(val) || val < 0) return;
    await sendMsg({ type: 'setAgentSpendingLimit', agentId: this._meta.id, limit: val });
    this._spendingLimit = val;
    this._spendingLimitDisplay = `$${val}/day`;
    this._limitStatus = 'Saved!';
    setTimeout(() => { this._limitStatus = ''; }, 1500);
  }

  private async _clearSpendingLimit(): Promise<void> {
    if (!this._meta) return;
    await sendMsg({ type: 'setAgentSpendingLimit', agentId: this._meta.id, limit: null });
    this._spendingLimit = null;
    this._spendingLimitDisplay = 'none';
    this._limitStatus = 'Cleared!';
    setTimeout(() => { this._limitStatus = ''; }, 1500);
  }

  // ── Render ──

  render() {
    if (!this.activeAgentId) {
      return html`<div class="view-padded"><div class="empty-state"><p>Select an agent to view its settings.</p></div></div>`;
    }
    if (this._loading) {
      return html`<div class="view-padded"><div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div></div>`;
    }
    if (this._error) {
      return html`<div class="view-padded"><div class="panel-error" style="display:block;">${this._error}</div></div>`;
    }
    if (!this._meta) {
      return html`<div class="view-padded"><div class="empty-state"><p>Select an agent to view its settings.</p></div></div>`;
    }

    const meta = this._meta;

    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2>${escapeHtml(meta.name)} Settings</h2>
        </div>

        <div class="agent-meta-row">
          <span class="meta-label">Role</span>
          <span class="${roleBadgeClass(meta.role)}">${escapeHtml(meta.role)}</span>
          <span class="meta-label" style="margin-left:var(--sp-4);">Visibility</span>
          <span class="${visBadgeClass(meta.visibility)}">${escapeHtml(meta.visibility)}</span>
          <span class="meta-label" style="margin-left:var(--sp-4);">Created</span>
          <span>${formatTimeFull(meta.createdAt)}</span>
        </div>

        ${this._renderNameSection(meta)}
        ${this._renderVisibilitySection(meta)}
        ${this._renderModelSection(meta)}
        ${this._renderToolsSection()}
        ${this._renderSkillsSection()}
        ${this._renderClaudeMdSection()}
        ${this._renderUsageSection()}
        ${this._renderSpendingSection()}
        ${this._renderDangerZone()}
      </div>
    `;
  }

  private _renderNameSection(meta: AgentMeta) {
    return html`
      <div class="agent-settings-section">
        <h3>Name</h3>
        <div class="agent-settings-field">
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <input type="text" id="agent-name-input" .value=${meta.name} style="flex:1;">
            <button class="btn btn-primary btn-sm" @click=${this._saveName}>${this._nameStatus || 'Save'}</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderVisibilitySection(meta: AgentMeta) {
    return html`
      <div class="agent-settings-section">
        <h3>Visibility</h3>
        <div class="agent-settings-field">
          <label>Who can see this agent?</label>
          <select @change=${this._changeVisibility}>
            <option value="private" ?selected=${meta.visibility === 'private'}>Private (hidden from other agents)</option>
            <option value="visible" ?selected=${meta.visibility === 'visible'}>Visible (can send/receive messages)</option>
            <option value="open" ?selected=${meta.visibility === 'open'}>Open (visible + shared artifacts)</option>
          </select>
        </div>
      </div>
    `;
  }

  private _renderModelSection(meta: AgentMeta) {
    const allProviders = listProviders();
    const activeProviderId = this._selectedProvider || this._globalSettings.activeProvider;
    const models = getFallbackModels(activeProviderId);
    const globalProviderLabel = allProviders.find(p => p.id === this._globalSettings.activeProvider)?.displayName || this._globalSettings.activeProvider;

    // Effective label
    const prov = this._selectedProvider || this._globalSettings.activeProvider;
    const provLabel = allProviders.find(p => p.id === prov)?.displayName || prov;
    const mdl = this._customModel.trim() || this._selectedModel;
    let effectiveLabel = '';
    if (!this._selectedProvider && !this._selectedModel && !this._customModel.trim()) {
      effectiveLabel = `(using global: ${provLabel}${this._globalSettings.model ? ' / ' + this._globalSettings.model : ''})`;
    } else {
      effectiveLabel = `(${provLabel}${mdl ? ' / ' + mdl : ''})`;
    }

    return html`
      <details class="agent-settings-section">
        <summary style="cursor:pointer;user-select:none;">
          <h3 style="display:inline;">Model</h3>
          <span style="font-size:var(--text-xs);color:var(--text-muted);margin-left:var(--sp-2);">${effectiveLabel}</span>
        </summary>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--sp-3) 0;">
          Override the global provider and model for this agent. Leave as "Use Global Default" to follow the global settings.
        </p>
        <div class="agent-settings-field">
          <label>Provider</label>
          <select @change=${(e: Event) => {
            this._selectedProvider = (e.target as HTMLSelectElement).value;
            this._selectedModel = '';
            this._customModel = '';
          }}>
            <option value="" ?selected=${!this._selectedProvider}>Use Global Default (${globalProviderLabel})</option>
            ${allProviders.map(p => html`<option value="${p.id}" ?selected=${this._selectedProvider === p.id}>${p.displayName}</option>`)}
          </select>
        </div>
        <div class="agent-settings-field">
          <label>Model</label>
          <select @change=${(e: Event) => {
            this._selectedModel = (e.target as HTMLSelectElement).value;
            if (this._selectedModel) this._customModel = '';
          }}>
            <option value="">(provider default)</option>
            ${models.map(m => html`<option value="${m.value}" ?selected=${this._selectedModel === m.value}>${m.label}</option>`)}
          </select>
        </div>
        <div class="agent-settings-field">
          <label>Custom Model ID</label>
          <input type="text" .value=${this._customModel} @input=${(e: Event) => {
            this._customModel = (e.target as HTMLInputElement).value;
            if (this._customModel.trim()) this._selectedModel = '';
          }} placeholder="e.g. gemini-2.5-flash, claude-haiku-4-5">
        </div>
        <div class="agent-settings-field" style="margin-top:var(--sp-4);border-top:1px solid var(--border-default);padding-top:var(--sp-3);">
          <label>API Key</label>
          <div style="display:flex;gap:var(--sp-3);align-items:center;margin-bottom:var(--sp-2);">
            <label style="display:flex;align-items:center;gap:var(--sp-1);cursor:pointer;font-size:var(--text-xs);">
              <input type="radio" name="agent-apikey-mode" value="global" ?checked=${this._apiKeyMode === 'global'} @change=${() => { this._apiKeyMode = 'global'; }} style="width:14px;height:14px;margin:0;"> Use Global
            </label>
            <label style="display:flex;align-items:center;gap:var(--sp-1);cursor:pointer;font-size:var(--text-xs);">
              <input type="radio" name="agent-apikey-mode" value="custom" ?checked=${this._apiKeyMode === 'custom'} @change=${() => { this._apiKeyMode = 'custom'; }} style="width:14px;height:14px;margin:0;"> Custom
            </label>
          </div>
          ${this._apiKeyMode === 'custom' ? html`
            <input type="password" id="agent-apikey-input" placeholder="${this._hasExistingApiKey ? 'Key saved (enter new value to replace)' : 'Enter API key for this agent'}" style="width:100%;">
          ` : nothing}
        </div>
        <div style="margin-top:var(--sp-3);">
          <button class="btn btn-primary btn-sm" @click=${this._saveModel}>${this._modelStatus || 'Save Model Configuration'}</button>
        </div>
      </details>
    `;
  }

  private _renderToolsSection() {
    const allRegisteredTools = toolRegistry.getAll();
    const toolsByCategory = new Map<string, ToolMeta[]>();
    for (const t of allRegisteredTools) {
      const cat = t.category;
      if (!toolsByCategory.has(cat)) toolsByCategory.set(cat, []);
      toolsByCategory.get(cat)!.push(t);
    }

    const categoryOrder = ['file', 'chrome', 'web', 'communication', 'wasm'];
    const categoryLabels: Record<string, string> = {
      file: 'File', chrome: 'Chrome', web: 'Web', communication: 'Communication', wasm: 'WASM',
    };

    return html`
      <details class="agent-settings-section">
        <summary style="cursor:pointer;user-select:none;"><h3 style="display:inline;">Tools</h3></summary>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--sp-3) 0;">
          Configure which tools this agent can use. read_file and list_directory are always enabled.
        </p>
        ${categoryOrder.map(cat => {
          const tools = toolsByCategory.get(cat);
          if (!tools || tools.length === 0) return nothing;
          const enabledCount = tools.filter(t => MINIMUM_TOOLS.includes(t.name) || !this._disabledTools.has(t.name)).length;
          return html`
            <details class="tools-category" style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden;margin-bottom:var(--sp-2);">
              <summary style="padding:8px 12px;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--text-primary);background:var(--bg-raised);user-select:none;">
                ${categoryLabels[cat] || cat} <span style="font-size:var(--text-xs);color:var(--text-muted);">(${enabledCount}/${tools.length})</span>
              </summary>
              <div class="tools-grid" style="padding:8px;">
                ${tools.map(t => {
                  const isMinimum = MINIMUM_TOOLS.includes(t.name);
                  const isChecked = isMinimum || !this._disabledTools.has(t.name);
                  return html`
                    <label class="tool-toggle">
                      <input type="checkbox" data-tool-name="${t.name}" ?checked=${isChecked} ?disabled=${isMinimum}>
                      <span class="tool-toggle-name">${t.name}</span>
                      <span class="tool-toggle-desc">${t.description}</span>
                      ${isMinimum ? html`<span class="tool-toggle-required">(required)</span>` : nothing}
                    </label>
                  `;
                })}
              </div>
            </details>
          `;
        })}
        <div style="margin-top:var(--sp-3);">
          <button class="btn btn-primary btn-sm" @click=${this._saveTools}>${this._toolsStatus || 'Save Tool Configuration'}</button>
        </div>
      </details>
    `;
  }

  private _renderSkillsSection() {
    return html`
      <div class="agent-settings-section">
        <h3>Skills</h3>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-3);">
          Skills add specialised knowledge and instructions to this agent's system prompt.
        </p>

        <!-- Installed skills list -->
        ${this._skills.length === 0
          ? html`<p style="font-size:var(--text-xs);color:var(--text-muted);">No skills installed.</p>`
          : html`
            <div class="skills-list">
              ${this._skills.map(skill => html`
                <div class="skill-card">
                  <div class="skill-card-header">
                    <span class="skill-card-name">${escapeHtml(skill.name)}</span>
                    ${skill.version ? html`<span class="badge badge-neutral" style="margin-left:var(--sp-2);">v${skill.version}</span>` : nothing}
                    <button class="btn btn-danger btn-xs" style="margin-left:auto;" @click=${() => this._removeSkill(skill.id)}>Remove</button>
                  </div>
                  <p class="skill-card-desc">${escapeHtml(skill.description)}</p>
                  <div class="skill-card-meta">
                    ${skill.author ? html`<span>Author: ${escapeHtml(skill.author)}</span>` : nothing}
                    ${skill.source ? html`<span>Source: ${escapeHtml(skill.source)}</span>` : nothing}
                    <span>Installed: ${new Date(skill.installedAt).toLocaleDateString()}</span>
                    <span>Files: ${skill.files.length}</span>
                  </div>
                </div>
              `)}
            </div>
          `
        }

        <!-- Browse skills -->
        <div style="margin-top:var(--sp-4);border-top:1px solid var(--border-default);padding-top:var(--sp-4);">
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3);cursor:pointer;" @click=${() => { this._showSkillBrowser = !this._showSkillBrowser; }}>
            <h4 style="margin:0;">Browse Skills</h4>
            <span style="font-size:var(--text-xs);color:var(--text-muted);">${this._showSkillBrowser ? '\u25BC' : '\u25B6'}</span>
          </div>
          ${this._showSkillBrowser ? html`
            <div class="skills-list">
              ${FEATURED_SKILLS.map(skill => html`
                <div class="skill-card">
                  <div class="skill-card-header">
                    <span class="skill-card-name">${escapeHtml(skill.name)}</span>
                    <button class="btn btn-primary btn-xs" style="margin-left:auto;" @click=${(e: Event) => this._installFeaturedSkill(skill.url, e.target as HTMLButtonElement)}>Install</button>
                  </div>
                  <p class="skill-card-desc">${escapeHtml(skill.description)}</p>
                  <div class="skill-card-meta">
                    <span>Author: ${escapeHtml(skill.author)}</span>
                    <span><a href="${skill.url}" target="_blank" style="color:var(--text-link);">GitHub</a></span>
                  </div>
                </div>
              `)}
            </div>
          ` : nothing}
        </div>

        <!-- Add skill -->
        <div class="skills-add-section" style="margin-top:var(--sp-4);">
          <h4>Add Skill</h4>
          <div class="agent-settings-field">
            <label>Import from URL</label>
            <div style="display:flex;gap:var(--sp-2);align-items:center;">
              <input type="text" .value=${this._skillUrl} @input=${(e: Event) => { this._skillUrl = (e.target as HTMLInputElement).value; }} placeholder="https://github.com/user/repo or direct SKILL.md URL" style="flex:1;">
              <button class="btn btn-primary btn-sm" @click=${this._importSkillFromUrl}>Import</button>
            </div>
            ${this._skillImportStatus ? html`<div style="margin-top:var(--sp-2);font-size:var(--text-xs);color:var(--text-muted);">${this._skillImportStatus}</div>` : nothing}
          </div>

          ${this._skillPreview ? html`
            <div style="margin-top:var(--sp-3);background:var(--bg-base);border:1px solid var(--border-default);border-radius:8px;padding:var(--sp-3);">
              <h5 style="margin:0 0 var(--sp-2) 0;">Skill Preview</h5>
              <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-2);">
                <strong>${escapeHtml(this._skillPreview.meta.name)}</strong>
                ${this._skillPreview.meta.author ? ` by ${escapeHtml(this._skillPreview.meta.author)}` : ''}
                ${this._skillPreview.meta.version ? ` (v${escapeHtml(this._skillPreview.meta.version)})` : ''}
                <br>${escapeHtml(this._skillPreview.meta.description)}
                <br>${this._skillPreview.fileCount} file(s): ${this._skillPreview.files.map(escapeHtml).join(', ')}
              </div>
              <pre style="font-size:var(--text-xs);max-height:200px;overflow-y:auto;background:var(--bg-surface);padding:var(--sp-2);border-radius:4px;white-space:pre-wrap;word-break:break-word;">${this._skillPreview.preview}</pre>
              <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
                <button class="btn btn-primary btn-sm" @click=${this._confirmSkillInstall}>Install</button>
                <button class="btn btn-sm" @click=${() => { this._skillPreview = null; this._pendingSkillUrl = ''; }}>Cancel</button>
              </div>
            </div>
          ` : nothing}

          <div class="agent-settings-field">
            <label>Skill Name</label>
            <input type="text" .value=${this._manualSkillName} @input=${(e: Event) => { this._manualSkillName = (e.target as HTMLInputElement).value; }} placeholder="e.g. Frontend Design">
          </div>
          <div class="agent-settings-field">
            <label>Description</label>
            <input type="text" .value=${this._manualSkillDesc} @input=${(e: Event) => { this._manualSkillDesc = (e.target as HTMLInputElement).value; }} placeholder="Brief description of the skill">
          </div>
          <div class="agent-settings-field">
            <label>SKILL.md Content</label>
            <textarea class="claude-md-editor" style="min-height:120px;" .value=${this._manualSkillContent} @input=${(e: Event) => { this._manualSkillContent = (e.target as HTMLTextAreaElement).value; }} placeholder="Paste SKILL.md content here..."></textarea>
          </div>
          <div style="margin-top:var(--sp-2);">
            <button class="btn btn-primary btn-sm" @click=${this._installManualSkill}>Install Skill</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderClaudeMdSection() {
    return html`
      <div class="agent-settings-section">
        <h3>CLAUDE.md</h3>
        <textarea class="claude-md-editor" id="agent-claude-md" .value=${this._claudeMd}></textarea>
        <div style="margin-top:var(--sp-3);">
          <button class="btn btn-primary btn-sm" @click=${this._saveClaudeMd}>${this._claudeMdStatus || 'Save CLAUDE.md'}</button>
        </div>
      </div>
    `;
  }

  private _renderUsageSection() {
    const records = this._usageRecords;
    const totalCost = this._usageCost;
    const totalIn = records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOut = records.reduce((s, r) => s + r.outputTokens, 0);

    // By model breakdown
    const byModel: Record<string, { cost: number; requests: number }> = {};
    for (const r of records) {
      if (!byModel[r.model]) byModel[r.model] = { cost: 0, requests: 0 };
      byModel[r.model].cost += r.estimatedCost;
      byModel[r.model].requests += 1;
    }
    const models = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost);
    const maxCost = models.length > 0 ? models[0][1].cost : 1;

    return html`
      <details class="agent-settings-section">
        <summary style="cursor:pointer;user-select:none;">
          <h3 style="display:inline;">Usage</h3>
          <span style="font-size:var(--text-xs);color:var(--text-muted);margin-left:var(--sp-2);">${totalCost > 0 ? formatCost(totalCost) : ''}</span>
        </summary>
        <div style="padding-top:var(--sp-3);">
          <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-3);align-items:center;">
            <select class="settings-select" style="padding:4px 8px;font-size:var(--text-xs);"
              .value=${this._usageRange}
              @change=${(e: Event) => { this._usageRange = (e.target as HTMLSelectElement).value; this._loadUsage(); }}>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="all">All</option>
            </select>
            <button class="btn btn-sm" @click=${() => this._loadUsage()}>Refresh</button>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-2);margin-bottom:var(--sp-3);">
            <div class="usage-stat-card"><div class="usage-stat-value">${formatCost(totalCost)}</div><div class="usage-stat-label">Cost</div></div>
            <div class="usage-stat-card"><div class="usage-stat-value">${formatTokens(totalIn)}/${formatTokens(totalOut)}</div><div class="usage-stat-label">In / Out</div></div>
            <div class="usage-stat-card"><div class="usage-stat-value">${records.length}</div><div class="usage-stat-label">Requests</div></div>
          </div>

          <!-- By model -->
          <div style="margin-bottom:var(--sp-3);">
            ${models.length === 0
              ? html`<div style="color:var(--text-muted);font-size:var(--text-xs);">No data</div>`
              : models.map(([name, data]) => html`
                <div class="usage-bar-row">
                  <span class="usage-bar-label" style="font-family:var(--font-mono);font-size:var(--text-xs);">${escapeHtml(name)}</span>
                  <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${maxCost > 0 ? (data.cost / maxCost * 100) : 0}%"></div></div>
                  <span class="usage-bar-value">${formatCost(data.cost)}</span>
                </div>
              `)
            }
          </div>

          <!-- Recent -->
          <div style="max-height:300px;overflow-y:auto;">
            ${records.length === 0
              ? html`<div style="color:var(--text-muted);font-size:var(--text-xs);">No requests yet</div>`
              : records.map(r => html`
                <div class="usage-request-row">
                  <span style="color:var(--text-muted);min-width:55px;" title=${new Date(r.timestamp).toLocaleString()}>${usageAgo(r.timestamp)}</span>
                  <span style="color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(r.model)}</span>
                  <span style="color:var(--text-muted);font-family:var(--font-mono);">${formatTokens(r.inputTokens)}/${formatTokens(r.outputTokens)}</span>
                  <span style="color:var(--text-primary);font-family:var(--font-mono);min-width:50px;text-align:right;">${formatCost(r.estimatedCost)}</span>
                </div>
              `)
            }
          </div>
        </div>
      </details>
    `;
  }

  private _renderSpendingSection() {
    return html`
      <details class="agent-settings-section">
        <summary style="cursor:pointer;user-select:none;">
          <h3 style="display:inline;">Spending Limit</h3>
          <span style="font-size:var(--text-xs);color:var(--text-muted);margin-left:var(--sp-2);">${this._spendingLimitDisplay}</span>
        </summary>
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin:var(--sp-3) 0;">
          Set a daily spending limit for this agent. When the limit is reached, the agent will pause and require your confirmation to continue.
        </p>
        <div class="agent-settings-field">
          <label>Daily Limit (USD)</label>
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <input type="number" id="agent-daily-limit" min="0" step="0.1" .value=${this._spendingLimit !== null ? String(this._spendingLimit) : ''} placeholder="e.g. 5.00" style="width:120px;">
            <button class="btn btn-primary btn-sm" @click=${this._saveSpendingLimit}>${this._limitStatus || 'Save'}</button>
            <button class="btn btn-sm" @click=${this._clearSpendingLimit}>Clear</button>
          </div>
        </div>
      </details>
    `;
  }

  private _renderDangerZone() {
    return html`
      <div class="agent-settings-section">
        <h3>Danger Zone</h3>
        <div class="danger-zone">
          <p>Permanently delete this agent and all its data.</p>
          <button class="btn btn-danger btn-sm" @click=${this._deleteAgent}>Delete Agent</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-agent-settings-view': ChaosAgentSettingsView;
  }
}
