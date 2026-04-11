/**
 * `<chaos-global-settings-view>` — Global Settings view.
 *
 * Provider API keys, active provider, theme, browser permissions,
 * tool permissions, archived agents, onboarding, and debug panel.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta, ApiKeys, Hook } from '../../storage/types.js';
import { getAllPermissions, setPermission, DEFAULT_PERMISSIONS, type PermissionLevel } from '../../tools/permissions.js';
import { hasPermission, hasHostPermissions } from '../../permissions.js';
import { getFallbackModels, listProviders } from '../../agents/provider-registry.js';
import { showOnboarding, resetOnboarding } from '../../ui/onboarding.js';
import { refreshSettings, refreshUsage, refreshHooks, refreshMcpServers } from '../../state/app-state.js';
import type { McpServerEntry } from '../../mcp/config.js';

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Types ──

interface BrowserPermEntry {
  id: string;
  label: string;
  permission: string;
  needsHost: boolean;
  granted: boolean;
}

interface ArchivedAgent {
  id: string;
  name: string;
  role: string;
  archivedAt?: string;
}

const PROVIDERS = ['anthropic', 'google', 'openai', 'openrouter', 'ollama'] as const;

@customElement('chaos-global-settings-view')
export class ChaosGlobalSettingsView extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Array }) agents: AgentMeta[] = [];

  // Provider state
  @state() private _keys: ApiKeys = {};
  @state() private _activeProvider = 'anthropic';
  @state() private _theme: 'system' | 'light' | 'dark' = 'system';
  @state() private _selectedModels: Record<string, string> = {};
  @state() private _customModels: Record<string, string> = {};

  // Browser permissions
  @state() private _browserPerms: BrowserPermEntry[] = [];

  // Tool permissions
  @state() private _toolPerms: Record<string, string> = {};

  // Archived agents
  @state() private _archivedAgents: ArchivedAgent[] = [];

  // MCP servers
  @state() private _mcpServers: McpServerEntry[] = [];
  @state() private _mcpAddingServer = false;
  @state() private _mcpNewName = '';
  @state() private _mcpNewUrl = '';
  @state() private _mcpNewApiKey = '';
  @state() private _mcpTestResults: Record<string, string> = {};

  // Debug
  @state() private _debugVisible = false;
  @state() private _debugClickCount = 0;
  @state() private _debugClickTimer: ReturnType<typeof setTimeout> | null = null;
  @state() private _verboseLogging = false;

  // Mic test
  @state() private _micTestResult = '';
  @state() private _micTestColor = 'var(--text-secondary)';
  @state() private _micTesting = false;
  private _testIframe: HTMLIFrameElement | null = null;
  private _micMessageHandler: ((event: MessageEvent) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-global-settings-view] connected');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._micMessageHandler) {
      window.removeEventListener('message', this._micMessageHandler);
      this._micMessageHandler = null;
    }
    if (this._testIframe) {
      this._testIframe.remove();
      this._testIframe = null;
    }
  }

  async refresh(): Promise<void> {
    console.log('[chaos-global-settings-view] refresh');
    await Promise.all([
      this._loadSettings(),
      this._loadBrowserPermissions(),
      this._loadToolPermissions(),
      this._loadArchivedAgents(),
      this._loadMcpServers(),
      this._checkDebugMode(),
    ]);
  }

  private async _loadSettings(): Promise<void> {
    try {
      const result = await sendMsg<{ keys: ApiKeys }>({ type: 'getApiKeys' });
      this._keys = result.keys;

      const settingsResult = await sendMsg<{ settings: { activeProvider: string; theme: string; model?: string } }>({ type: 'getSettings' });
      const settings = settingsResult.settings;
      this._activeProvider = settings.activeProvider || 'anthropic';
      this._theme = (settings.theme || 'system') as 'system' | 'light' | 'dark';

      // Restore selected model on the active provider
      if (settings.model) {
        const models = getFallbackModels(this._activeProvider);
        const inList = models.some(m => m.value === settings.model);
        if (inList) {
          this._selectedModels = { ...this._selectedModels, [this._activeProvider]: settings.model };
        } else {
          this._customModels = { ...this._customModels, [this._activeProvider]: settings.model };
        }
      }
    } catch (err) {
      console.error('[global-settings] Failed to load settings:', err);
    }
  }

  private async _loadBrowserPermissions(): Promise<void> {
    const browserPerms = [
      { id: 'page-content', label: 'Read page content', permission: 'scripting' as const, needsHost: true },
      { id: 'tabs', label: 'Tab management', permission: 'tabs' as const, needsHost: false },
      { id: 'bookmarks', label: 'Bookmarks', permission: 'bookmarks' as const, needsHost: false },
      { id: 'history', label: 'Browsing history', permission: 'history' as const, needsHost: false },
    ];

    const entries: BrowserPermEntry[] = [];
    for (const perm of browserPerms) {
      const granted = await hasPermission(perm.permission) && (!perm.needsHost || await hasHostPermissions());
      entries.push({ ...perm, granted });
    }
    this._browserPerms = entries;
  }

  private async _loadToolPermissions(): Promise<void> {
    this._toolPerms = await getAllPermissions();
  }

  private async _loadArchivedAgents(): Promise<void> {
    try {
      const result = await sendMsg<{ agents: ArchivedAgent[] }>({ type: 'listArchivedAgents' });
      this._archivedAgents = result.agents || [];
    } catch {
      this._archivedAgents = [];
    }
  }

  private async _checkDebugMode(): Promise<void> {
    const hashDebug = window.location.hash.includes('debug');
    const stored = await chrome.storage.local.get('chaos:debug-mode');
    this._debugVisible = hashDebug || stored['chaos:debug-mode'] === true;

    if (hashDebug && !stored['chaos:debug-mode']) {
      await chrome.storage.local.set({ 'chaos:debug-mode': true });
    }

    if (this._debugVisible) {
      const verboseStored = await chrome.storage.local.get('chaos:verbose-logging');
      this._verboseLogging = !!verboseStored['chaos:verbose-logging'];
    }
  }

  // ── Actions ──

  private async _saveProviderSettings(): Promise<void> {
    const keys: ApiKeys = {
      anthropic: this._keys.anthropic?.trim() || undefined,
      google: this._keys.google?.trim() || undefined,
      openai: this._keys.openai?.trim() || undefined,
      openrouter: this._keys.openrouter?.trim() || undefined,
    };
    await sendMsg({ type: 'setApiKeys', keys });

    const provider = this._activeProvider;
    const customModel = this._customModels[provider]?.trim();
    const selectModel = this._selectedModels[provider];
    const model = customModel || selectModel || undefined;

    const settingsResult = await sendMsg<{ settings: { theme: string } }>({ type: 'getSettings' });
    const currentTheme = settingsResult.settings?.theme || 'system';
    await sendMsg({ type: 'setSettings', settings: { activeProvider: provider, theme: currentTheme, model } });
    await refreshSettings();
    console.log('[global-settings] Settings saved');
  }

  private async _saveTheme(): Promise<void> {
    const settingsResult = await sendMsg<{ settings: { activeProvider: string; model?: string } }>({ type: 'getSettings' });
    const current = settingsResult.settings;
    await sendMsg({ type: 'setSettings', settings: { activeProvider: current?.activeProvider || 'anthropic', theme: this._theme, model: current?.model } });
    await refreshSettings();

    // Apply theme
    const html = document.documentElement;
    if (this._theme === 'system') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', this._theme);
    }
    console.log('[global-settings] Theme saved:', this._theme);
  }

  private async _requestBrowserPermission(entry: BrowserPermEntry): Promise<void> {
    const request: chrome.permissions.Permissions = { permissions: [entry.permission as chrome.runtime.ManifestPermissions] };
    if (entry.needsHost) request.origins = ['<all_urls>'];
    try {
      const granted = await chrome.permissions.request(request);
      // Update the entry in the list
      this._browserPerms = this._browserPerms.map(p =>
        p.id === entry.id ? { ...p, granted } : p
      );
    } catch (err) {
      console.error(`[global-settings] Permission request failed for ${entry.permission}:`, err);
    }
  }

  private async _saveToolPermissions(): Promise<void> {
    const selects = this.querySelectorAll<HTMLSelectElement>('.perm-select');
    for (const sel of selects) {
      const toolName = sel.dataset.tool!;
      const level = sel.value as PermissionLevel;
      await setPermission(toolName, level);
    }
    console.log('[global-settings] Tool permissions saved');
  }

  private async _restoreArchivedAgent(agentId: string): Promise<void> {
    try {
      await sendMsg({ type: 'restoreAgent', agentId });
      await this._loadArchivedAgents();
      sendPortMessage({ type: 'listAgents' });
    } catch (err) {
      console.error('[global-settings] Failed to restore agent:', err);
    }
  }

  private _deleteArchivedAgent(agentId: string): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div style="padding:20px;max-width:320px;">
        <h3 style="margin-bottom:12px;">Delete Permanently</h3>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:16px;">This will permanently delete all data for this archived agent. This cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn" id="arch-del-cancel">Cancel</button>
          <button class="btn btn-danger" id="arch-del-confirm">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#arch-del-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#arch-del-confirm')?.addEventListener('click', async () => {
      try {
        await sendMsg({ type: 'deleteArchivedAgent', agentId });
        await this._loadArchivedAgents();
      } catch (err) {
        console.error('[global-settings] Failed to delete archived agent:', err);
      }
      dlg.close();
      dlg.remove();
    });
  }

  private async _rerunOnboarding(): Promise<void> {
    await resetOnboarding();
    const result = await showOnboarding(sendMsg);
    if (result) {
      await this._loadSettings();
    }
  }

  private async _rerunSmartStart(): Promise<void> {
    await chrome.storage.local.remove('chaos:smart-start-completed');
    document.getElementById('smart-start-container')?.remove();
    // Dispatch event for app.ts to pick up
    this.dispatchEvent(new CustomEvent('rerun-smart-start', { bubbles: true, composed: true }));
  }

  private _onTitleClick(e: Event): void {
    e.preventDefault();
    this._debugClickCount++;
    if (this._debugClickTimer) clearTimeout(this._debugClickTimer);
    this._debugClickTimer = setTimeout(() => { this._debugClickCount = 0; }, 2000);
    if (this._debugClickCount >= 5) {
      this._debugClickCount = 0;
      chrome.storage.local.get('chaos:debug-mode').then((r) => {
        const newVal = !r['chaos:debug-mode'];
        chrome.storage.local.set({ 'chaos:debug-mode': newVal });
        this._debugVisible = newVal;
        console.log(`[CHAOS] Debug mode ${newVal ? 'enabled' : 'disabled'}`);
      });
    }
  }

  // ── MCP Server actions ──

  private async _loadMcpServers(): Promise<void> {
    try {
      const result = await sendMsg<{ servers: McpServerEntry[] }>({ type: 'getMcpServers' });
      this._mcpServers = result.servers || [];
    } catch {
      this._mcpServers = [];
    }
  }

  private async _addMcpServer(): Promise<void> {
    const name = this._mcpNewName.trim();
    const url = this._mcpNewUrl.trim();
    if (!name || !url) return;

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const server: McpServerEntry = {
      id,
      name,
      url,
      apiKey: this._mcpNewApiKey.trim() || undefined,
      enabled: true,
      global: true,
    };

    await sendMsg({ type: 'addMcpServer', server });
    this._mcpNewName = '';
    this._mcpNewUrl = '';
    this._mcpNewApiKey = '';
    this._mcpAddingServer = false;
    await this._loadMcpServers();
    await refreshMcpServers();
    console.log(`[global-settings] Added MCP server: ${name}`);
  }

  private async _removeMcpServer(id: string): Promise<void> {
    await sendMsg({ type: 'removeMcpServer', id });
    await this._loadMcpServers();
    await refreshMcpServers();
    console.log(`[global-settings] Removed MCP server: ${id}`);
  }

  private async _toggleMcpServer(id: string, enabled: boolean): Promise<void> {
    await sendMsg({ type: 'updateMcpServer', id, updates: { enabled } });
    await this._loadMcpServers();
    await refreshMcpServers();
  }

  private async _testMcpServer(server: McpServerEntry): Promise<void> {
    this._mcpTestResults = { ...this._mcpTestResults, [server.id]: 'Testing...' };
    try {
      const result = await sendMsg<{ success: boolean; tools?: number; resources?: number; prompts?: number; error?: string }>({
        type: 'testMcpServer',
        server: { url: server.url, name: server.name, apiKey: server.apiKey, headers: server.headers },
      });
      if (result.success) {
        this._mcpTestResults = {
          ...this._mcpTestResults,
          [server.id]: `Connected — ${result.tools} tools, ${result.resources} resources, ${result.prompts} prompts`,
        };
      } else {
        this._mcpTestResults = { ...this._mcpTestResults, [server.id]: `Failed: ${result.error}` };
      }
    } catch (err) {
      this._mcpTestResults = {
        ...this._mcpTestResults,
        [server.id]: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private _toggleMicTest(): void {
    if (this._testIframe) {
      this._testIframe.contentWindow?.postMessage({ target: 'chaos-recognition', type: 'stop' }, '*');
      this._testIframe.remove();
      this._testIframe = null;
      this._micTesting = false;
      if (this._micMessageHandler) {
        window.removeEventListener('message', this._micMessageHandler);
        this._micMessageHandler = null;
      }
      return;
    }

    this._micTestResult = 'Starting...';
    this._micTestColor = 'var(--text-secondary)';
    this._micTesting = true;

    this._testIframe = document.createElement('iframe');
    this._testIframe.src = chrome.runtime.getURL('src/voice/recognition-frame.html');
    this._testIframe.allow = 'microphone';
    this._testIframe.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;border:none;opacity:0;';
    document.body.appendChild(this._testIframe);

    this._micMessageHandler = (event: MessageEvent) => {
      if (event.data?.source !== 'chaos-recognition') return;
      switch (event.data.type) {
        case 'recognition-started':
          this._micTestResult = 'Mic working. Speak now...';
          this._micTestColor = 'var(--success-text)';
          break;
        case 'recognition-result':
          if (event.data.finalTranscript || event.data.interimTranscript) {
            this._micTestResult = 'Heard: "' + (event.data.finalTranscript || event.data.interimTranscript).trim().slice(0, 60) + '"';
            this._micTestColor = 'var(--success-text)';
          }
          break;
        case 'recognition-error':
          this._micTestResult = 'Error: ' + event.data.error;
          this._micTestColor = 'var(--danger)';
          break;
        case 'recognition-ended':
          if (this._micMessageHandler) {
            window.removeEventListener('message', this._micMessageHandler);
            this._micMessageHandler = null;
          }
          if (this._testIframe) {
            this._testIframe.remove();
            this._testIframe = null;
          }
          this._micTesting = false;
          break;
      }
    };
    window.addEventListener('message', this._micMessageHandler);

    // Auto-stop after 10 seconds
    setTimeout(() => {
      if (this._testIframe) {
        this._testIframe.contentWindow?.postMessage({ target: 'chaos-recognition', type: 'stop' }, '*');
      }
    }, 10000);
  }

  // ── Debug actions ──

  private async _debugResetFirstRun(): Promise<void> {
    await chrome.storage.local.remove(['chaos:onboarding-completed', 'chaos:needs-onboarding', 'chaos:smart-start-completed']);
    await chrome.storage.local.set({ 'chaos:needs-onboarding': true });
    console.log('[CHAOS debug] First run flags reset');
  }

  private async _debugResetSmartStart(): Promise<void> {
    await chrome.storage.local.remove('chaos:smart-start-completed');
    console.log('[CHAOS debug] Smart start flag reset');
  }

  private async _debugClearUsage(): Promise<void> {
    await sendMsg({ type: 'clearUsage' });
    await refreshUsage();
    console.log('[CHAOS debug] Usage data cleared');
  }

  private async _debugClearConversations(): Promise<void> {
    for (const agent of this.agents) {
      sendPortMessage({ type: 'clearConversation', agentId: agent.id });
    }
    console.log('[CHAOS debug] All conversations cleared');
  }

  private async _debugClearHooks(): Promise<void> {
    const stored = await chrome.storage.local.get('chaos:hooks');
    const hooks = (stored['chaos:hooks'] as Hook[] | undefined) || [];
    for (const hook of hooks) {
      sendPortMessage({ type: 'removeHook', hookId: hook.id });
    }
    // Allow background to process all removals, then refresh signal
    setTimeout(() => refreshHooks(), 200);
    console.log(`[CHAOS debug] Cleared ${hooks.length} hooks`);
  }

  private _debugResetMemory(): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div style="padding:20px;max-width:320px;">
        <h3 style="margin-bottom:12px;">Reset Agent Memory</h3>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:16px;">This will delete all agent files (CLAUDE.md, memories, activity logs). Agents will remain but lose all memory. Continue?</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn" id="mem-cancel">Cancel</button>
          <button class="btn btn-danger" id="mem-confirm">Reset</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#mem-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#mem-confirm')?.addEventListener('click', async () => {
      try {
        const root = await navigator.storage.getDirectory();
        for (const agent of this.agents) {
          try {
            const agentDir = await root.getDirectoryHandle(agent.id, { create: false });
            for await (const [name] of (agentDir as any).entries()) {
              try { await agentDir.removeEntry(name, { recursive: true }); } catch { /* ignore */ }
            }
          } catch { /* agent dir may not exist */ }
        }
        console.log('[CHAOS debug] Agent memory reset');
      } catch (err) {
        console.error('[CHAOS debug] Failed to reset memory:', err);
      }
      dlg.close();
      dlg.remove();
    });
  }

  private _debugFactoryReset(): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `
      <div style="padding:20px;max-width:320px;">
        <h3 style="margin-bottom:12px;">Factory Reset</h3>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:16px;">This will delete ALL data: agents, hooks, conversations, memory, settings. The extension will return to first-install state. This cannot be undone. Continue?</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn" id="fr-cancel">Cancel</button>
          <button class="btn btn-danger" id="fr-confirm">Factory Reset</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#fr-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#fr-confirm')?.addEventListener('click', async () => {
      try {
        await chrome.storage.local.clear();
        await chrome.storage.sync.clear();
        try {
          const root = await navigator.storage.getDirectory();
          for await (const [name] of (root as any).entries()) {
            try { await root.removeEntry(name, { recursive: true }); } catch { /* ignore */ }
          }
        } catch (err) { console.warn('[CHAOS debug] OPFS clear failed:', err); }
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
        } catch (err) { console.warn('[CHAOS debug] IDB clear failed:', err); }
        console.log('[CHAOS debug] Factory reset complete, reloading...');
        location.reload();
      } catch (err) {
        console.error('[CHAOS debug] Factory reset failed:', err);
      }
      dlg.close();
      dlg.remove();
    });
  }

  private async _debugDumpState(): Promise<void> {
    const local = await chrome.storage.local.get(null);
    const sync = await chrome.storage.sync.get(null);
    console.log('=== CHAOS Debug State Dump ===');
    console.log('chrome.storage.local:', local);
    console.log('chrome.storage.sync:', sync);
    console.log('Agents in memory:', this.agents);
    try {
      const root = await navigator.storage.getDirectory();
      const opfsEntries: string[] = [];
      for await (const [name, handle] of (root as any).entries()) {
        opfsEntries.push(`${name} (${handle.kind})`);
      }
      console.log('OPFS root entries:', opfsEntries);
    } catch (err) { console.log('OPFS listing failed:', err); }
    console.log('=== End Debug State Dump ===');
  }

  private async _debugToggleVerbose(): Promise<void> {
    this._verboseLogging = !this._verboseLogging;
    await chrome.storage.local.set({ 'chaos:verbose-logging': this._verboseLogging });
    console.log(`[CHAOS debug] Verbose logging ${this._verboseLogging ? 'enabled' : 'disabled'}`);
  }

  // ── Render ──

  render() {
    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2 style="user-select:none;cursor:default;" @click=${this._onTitleClick}>Global Settings</h2>
        </div>

        <div class="settings-grid">
          ${this._renderProviders()}
          ${this._renderAppearance()}
          ${this._renderVoiceInput()}
          ${this._renderBrowserPermissions()}
          ${this._renderToolPermissions()}
          ${this._renderMcpServers()}
          ${this._renderArchivedAgents()}
          ${this._renderSetup()}
        </div>

        ${this._debugVisible ? this._renderDebugPanel() : nothing}
      </div>
    `;
  }

  private _renderProviders() {
    const allProviders = listProviders();

    const providerConfig = (providerId: string, label: string, keyId: string, placeholder: string, isPassword: boolean = true) => {
      const models = getFallbackModels(providerId);
      const isActive = this._activeProvider === providerId;
      const keyValue = (this._keys as Record<string, string | undefined>)[keyId] || '';

      return html`
        <label class="provider-row" data-provider="${providerId}">
          <input type="radio" name="active-provider" value="${providerId}" ?checked=${isActive}
            @change=${() => { this._activeProvider = providerId; }}>
          <div class="provider-info">
            <span class="provider-name">${label}</span>
            <input type="${isPassword ? 'password' : 'text'}" class="provider-key-input" placeholder="${placeholder}"
              .value=${keyValue}
              @click=${(e: Event) => e.stopPropagation()}
              @input=${(e: Event) => { this._keys = { ...this._keys, [keyId]: (e.target as HTMLInputElement).value }; }}>
          </div>
          <div class="provider-model-area" style="display:${isActive ? 'flex' : 'none'};">
            <select class="provider-model-select"
              .value=${this._selectedModels[providerId] || ''}
              @change=${(e: Event) => { this._selectedModels = { ...this._selectedModels, [providerId]: (e.target as HTMLSelectElement).value }; if ((e.target as HTMLSelectElement).value) this._customModels = { ...this._customModels, [providerId]: '' }; }}>
              <option value="">(provider default)</option>
              ${models.map(m => html`<option value="${m.value}" ?selected=${this._selectedModels[providerId] === m.value}>${m.label}</option>`)}
            </select>
            <input type="text" class="provider-custom-model" placeholder="Custom model ID..."
              .value=${this._customModels[providerId] || ''}
              @click=${(e: Event) => e.stopPropagation()}
              @input=${(e: Event) => { this._customModels = { ...this._customModels, [providerId]: (e.target as HTMLInputElement).value }; if ((e.target as HTMLInputElement).value.trim()) this._selectedModels = { ...this._selectedModels, [providerId]: '' }; }}>
          </div>
        </label>
      `;
    };

    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>Providers</h3>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:12px;">Select your active provider, enter API keys, and choose a model.</p>
        <div style="display:grid;gap:8px;">
          ${providerConfig('anthropic', 'Anthropic', 'anthropic', 'sk-ant-...')}
          ${providerConfig('google', 'Google (Gemini)', 'google', 'AI...')}
          ${providerConfig('openai', 'OpenAI', 'openai', 'sk-...')}
          ${providerConfig('openrouter', 'OpenRouter', 'openrouter', 'sk-or-...')}
          ${providerConfig('ollama', 'Ollama (Local)', 'ollama', 'http://localhost:11434/v1', false)}
        </div>
        <div class="settings-actions" style="margin-top:12px;">
          <button class="btn btn-primary" @click=${this._saveProviderSettings}>Save</button>
        </div>
      </div>
    `;
  }

  private _renderAppearance() {
    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>Appearance</h3>
        <div class="settings-field" style="max-width:300px;">
          <label>Theme</label>
          <select .value=${this._theme} @change=${(e: Event) => { this._theme = (e.target as HTMLSelectElement).value as 'system' | 'light' | 'dark'; }}>
            <option value="system" ?selected=${this._theme === 'system'}>System (auto)</option>
            <option value="light" ?selected=${this._theme === 'light'}>Light</option>
            <option value="dark" ?selected=${this._theme === 'dark'}>Dark</option>
          </select>
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" @click=${this._saveTheme}>Save Theme</button>
        </div>
      </div>
    `;
  }

  private _renderVoiceInput() {
    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>Voice Input</h3>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:12px;">Test your microphone and voice recognition. Global hotkey: Ctrl+Shift+U (Cmd+Shift+U on Mac).</p>
        <div style="display:flex;align-items:center;gap:var(--sp-3);">
          <button class="btn btn-ghost" @click=${this._toggleMicTest}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            ${this._micTesting ? 'Stop Test' : 'Test Microphone'}
          </button>
          <span style="font-size:var(--text-xs);color:${this._micTestColor};">${this._micTestResult}</span>
        </div>
      </div>
    `;
  }

  private _renderBrowserPermissions() {
    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>Browser Permissions</h3>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:12px;">Manage Chrome extension permissions.</p>
        <div>
          ${this._browserPerms.map(perm => html`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;font-size:var(--text-sm);border-bottom:1px solid var(--border-subtle);">
              <span style="color:var(--text-secondary);">${perm.label}</span>
              <button class="btn" @click=${() => this._requestBrowserPermission(perm)}
                style="padding:4px 12px;border-radius:4px;font-size:var(--text-xs);cursor:pointer;border:1px solid ${perm.granted ? 'var(--success)' : 'var(--accent)'};background:${perm.granted ? 'var(--success-subtle)' : 'var(--accent-subtle)'};color:${perm.granted ? 'var(--success)' : 'var(--accent-text)'};">
                ${perm.granted ? 'Enabled' : 'Enable'}
              </button>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderToolPermissions() {
    const toolNames = Object.keys(DEFAULT_PERMISSIONS).sort();
    const groups: Record<string, string[]> = {};
    for (const name of toolNames) {
      const cat = name.split('_')[0] || 'other';
      (groups[cat] ??= []).push(name);
    }
    const categoryLabels: Record<string, string> = {
      read: 'File (Read)', write: 'File (Write)', edit: 'File (Edit)',
      append: 'File (Append)', mkdir: 'File (Mkdir)', list: 'File (List)',
      tab: 'Tabs', bookmark: 'Bookmarks', history: 'History',
      alarm: 'Alarms', message: 'Messages', task: 'Tasks',
      artifact: 'Artifacts', agent: 'Agents', fetch: 'Web',
    };

    return html`
      <details class="settings-card" style="grid-column: 1 / -1;">
        <summary style="cursor:pointer;user-select:none;"><h3 style="display:inline;">Tool Permissions</h3></summary>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin:12px 0;">Control which tools agents can use.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">
          ${Object.entries(groups).map(([cat, names]) => {
            const label = categoryLabels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
            return html`
              <details style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden;">
                <summary style="padding:8px 12px;cursor:pointer;font-size:var(--text-sm);font-weight:500;color:var(--text-primary);background:var(--bg-raised);user-select:none;">${label} <span style="font-size:var(--text-xs);color:var(--text-muted);">(${names.length})</span></summary>
                <div style="display:grid;gap:4px;padding:8px;">
                  ${names.map(name => {
                    const level = this._toolPerms[name] ?? 'ask';
                    return html`
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-base);border-radius:4px;border:1px solid var(--border-subtle);">
                        <span style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--text-secondary);">${name}</span>
                        <select class="perm-select" data-tool="${name}" style="background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:4px;padding:2px 6px;font-size:var(--text-xs);outline:none;">
                          <option value="always" ?selected=${level === 'always'}>Always</option>
                          <option value="ask" ?selected=${level === 'ask'}>Ask</option>
                          <option value="never" ?selected=${level === 'never'}>Never</option>
                        </select>
                      </div>
                    `;
                  })}
                </div>
              </details>
            `;
          })}
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" @click=${this._saveToolPermissions}>Save Permissions</button>
        </div>
      </details>
    `;
  }

  private _renderMcpServers() {
    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>MCP Servers</h3>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:12px;">Connect to external MCP servers to give agents additional tools, resources, and prompts.</p>

        ${this._mcpServers.length === 0 && !this._mcpAddingServer
          ? html`<p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:12px;">No MCP servers configured.</p>`
          : nothing
        }

        ${this._mcpServers.map(server => {
          const testResult = this._mcpTestResults[server.id];
          const isSuccess = testResult?.startsWith('Connected');
          const isTesting = testResult === 'Testing...';
          return html`
            <div style="display:flex;flex-direction:column;gap:6px;padding:10px;margin-bottom:8px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--bg-raised);">
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${server.enabled ? 'var(--success)' : 'var(--text-muted)'};"></span>
                  <strong style="font-size:var(--text-sm);">${escapeHtml(server.name)}</strong>
                  <span style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(server.url)}</span>
                </div>
                <div style="display:flex;gap:4px;align-items:center;">
                  <button class="btn btn-xs" @click=${() => this._testMcpServer(server)} ?disabled=${isTesting}>
                    ${isTesting ? 'Testing...' : 'Test'}
                  </button>
                  <button class="btn btn-xs" @click=${() => this._toggleMcpServer(server.id, !server.enabled)}>
                    ${server.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button class="btn btn-danger btn-xs" @click=${() => this._removeMcpServer(server.id)}>Remove</button>
                </div>
              </div>
              ${testResult ? html`
                <span style="font-size:var(--text-xs);color:${isSuccess ? 'var(--success-text)' : isTesting ? 'var(--text-secondary)' : 'var(--danger)'};">
                  ${testResult}
                </span>
              ` : nothing}
            </div>
          `;
        })}

        ${this._mcpAddingServer ? html`
          <div style="display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--accent);border-radius:6px;background:var(--bg-base);margin-bottom:8px;">
            <input type="text" placeholder="Server name (e.g. GitHub)" .value=${this._mcpNewName}
              @input=${(e: Event) => { this._mcpNewName = (e.target as HTMLInputElement).value; }}
              style="padding:6px 10px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-raised);color:var(--text-primary);font-size:var(--text-sm);">
            <input type="text" placeholder="URL (e.g. https://mcp.example.com/sse)" .value=${this._mcpNewUrl}
              @input=${(e: Event) => { this._mcpNewUrl = (e.target as HTMLInputElement).value; }}
              style="padding:6px 10px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-raised);color:var(--text-primary);font-size:var(--text-sm);">
            <input type="password" placeholder="API key (optional)" .value=${this._mcpNewApiKey}
              @input=${(e: Event) => { this._mcpNewApiKey = (e.target as HTMLInputElement).value; }}
              style="padding:6px 10px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-raised);color:var(--text-primary);font-size:var(--text-sm);">
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary btn-sm" @click=${this._addMcpServer}>Add</button>
              <button class="btn btn-sm" @click=${() => { this._mcpAddingServer = false; }}>Cancel</button>
            </div>
          </div>
        ` : html`
          <button class="btn btn-ghost" @click=${() => { this._mcpAddingServer = true; }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add MCP Server
          </button>
        `}
      </div>
    `;
  }

  private _renderArchivedAgents() {
    return html`
      <details class="settings-card" style="grid-column: 1 / -1;">
        <summary style="cursor:pointer;user-select:none;"><h3 style="display:inline;">Archived Agents</h3></summary>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin:12px 0;">Agents that were archived. You can restore or permanently delete them.</p>
        ${this._archivedAgents.length === 0
          ? html`<p style="font-size:var(--text-xs);color:var(--text-muted);">No archived agents.</p>`
          : html`
            <div class="skills-list">
              ${this._archivedAgents.map(agent => html`
                <div class="skill-card">
                  <div class="skill-card-header">
                    <span class="skill-card-name">${escapeHtml(agent.name)}</span>
                    <span class="badge badge-neutral" style="margin-left:var(--sp-2);">${escapeHtml(agent.role)}</span>
                    <div style="margin-left:auto;display:flex;gap:var(--sp-1);">
                      <button class="btn btn-primary btn-xs" @click=${() => this._restoreArchivedAgent(agent.id)}>Restore</button>
                      <button class="btn btn-danger btn-xs" @click=${() => this._deleteArchivedAgent(agent.id)}>Delete</button>
                    </div>
                  </div>
                  <div class="skill-card-meta">
                    <span>Archived: ${agent.archivedAt ? new Date(agent.archivedAt).toLocaleDateString() : 'Unknown'}</span>
                  </div>
                </div>
              `)}
            </div>
          `
        }
      </details>
    `;
  }

  private _renderSetup() {
    return html`
      <div class="settings-card" style="grid-column: 1 / -1;">
        <h3>Setup</h3>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:12px;">Re-run the initial setup wizard to change your provider or API key.</p>
        <button class="btn btn-ghost" @click=${this._rerunOnboarding}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
          Re-run setup wizard
        </button>
        <button class="btn btn-ghost" @click=${this._rerunSmartStart}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Re-run Smart Start
        </button>
      </div>
    `;
  }

  private _renderDebugPanel() {
    const debugAction = (title: string, description: string, btnLabel: string, onClick: () => void, danger: boolean = false) => html`
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:var(--text-sm);">${title}</strong>
          <p style="font-size:var(--text-xs);color:var(--text-muted);">${description}</p>
        </div>
        <button class="btn btn-sm ${danger ? 'btn-danger' : ''}" @click=${onClick}>${btnLabel}</button>
      </div>
    `;

    return html`
      <div style="margin-top:var(--sp-4);">
        <div class="settings-grid">
          <div class="settings-card" style="grid-column: 1 / -1;border-color:var(--danger);">
            <h3 style="color:var(--danger);">Debug Tools</h3>
            <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-3);">Developer tools for testing. These actions can reset state.</p>
            <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
              ${debugAction('Reset First Run', 'Clear onboarding + smart start flags to re-trigger the first run experience', 'Reset', this._debugResetFirstRun)}
              ${debugAction('Reset Smart Start', 'Re-trigger the smart start suggestions without full onboarding', 'Reset', this._debugResetSmartStart)}
              ${debugAction('Clear Usage Data', 'Wipe all token usage and cost tracking records', 'Clear', this._debugClearUsage)}
              ${debugAction('Clear Conversations', 'Delete all saved conversation history for all agents', 'Clear', this._debugClearConversations)}
              ${debugAction('Clear All Hooks', 'Remove all hooks (browser event automations)', 'Clear', this._debugClearHooks)}
              ${debugAction('Reset Agent Memory', 'Delete all agent files. Agents remain but lose all memory.', 'Reset', () => this._debugResetMemory(), true)}
              ${debugAction('Factory Reset', 'Delete everything. Extension returns to first-install state.', 'Factory Reset', () => this._debugFactoryReset(), true)}
              ${debugAction('Dump State', 'Log all storage state to console for debugging', 'Dump', this._debugDumpState)}
              ${debugAction('Verbose Logging', 'Enable detailed console logging for all agent operations', this._verboseLogging ? 'Disable' : 'Enable', this._debugToggleVerbose)}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-global-settings-view': ChaosGlobalSettingsView;
  }
}
