/**
 * `<chaos-hooks-view>` — Hooks management view.
 *
 * Shows hook presets palette, create/edit hook form with dynamic
 * trigger-type-specific filters, hooks list with enable/disable/edit/delete,
 * trigger count display, and prompt refinement.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta, Hook, HookTrigger } from '../../storage/types.js';
import { hooks as hooksSignal, refreshHooks } from '../../state/app-state.js';
import { SignalWatcher } from '../../state/signal-watcher.js';

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

function formatTrigger(trigger: HookTrigger): string {
  switch (trigger.type) {
    case 'bookmark-created':
      return `Bookmark created${trigger.folderId ? ` (folder: ${trigger.folderName || trigger.folderId})` : ''}`;
    case 'tab-navigated':
      return `Tab navigated to ${trigger.urlPattern}`;
    case 'tab-created': return 'Tab created';
    case 'tab-closed': return 'Tab closed';
    case 'download-completed':
      return `Download completed${trigger.filenamePattern ? ` (${trigger.filenamePattern})` : ''}`;
    case 'history-visited':
      return `Visited URL matching ${trigger.urlPattern}`;
    case 'idle-changed':
      return `Idle state changed to ${trigger.state}`;
    case 'browser-startup': return 'Browser startup';
    case 'omnibox':
      return `Omnibox keyword: "${trigger.keyword}"`;
    case 'context-menu':
      return `Context menu: "${trigger.label}"`;
    case 'reading-list-changed': return 'Reading list changed';
    case 'window-created': return 'Window created';
    case 'window-focused': return 'Window focused';
    case 'window-closed': return 'Window closed';
    case 'clipboard-changed': return 'Clipboard changed';
    case 'filesystem-changed':
      return `File system changed${trigger.path ? ` (${trigger.path})` : ''}`;
    default:
      return (trigger as HookTrigger).type;
  }
}

// ── Presets ──

const HOOK_PRESETS = [
  { label: 'Summarize bookmarks', description: 'Summarize new bookmarks', trigger: 'bookmark-created', prompt: 'A new bookmark was added. Read the bookmarked page content, write a brief summary to memories/bookmarks/, and note any action items in TODO.md.' },
  { label: 'Morning briefing', description: 'Daily morning briefing on browser startup', trigger: 'browser-startup', prompt: 'Good morning! Review my recent browsing history, check for any pending TODOs, and give me a brief morning briefing of what I was working on and what might need attention today.' },
  { label: 'Track GitHub activity', description: 'Track when I visit GitHub repos', trigger: 'tab-navigated', filter: '*.github.com/*', prompt: 'The user navigated to a GitHub page. Note the repository name and what they might be working on. Update memories/projects.md with any new repos.' },
  { label: 'Download organizer', description: 'Log and categorize downloads', trigger: 'download-completed', prompt: 'A file was downloaded. Note the filename and source in memories/downloads.md. If it looks like a document or resource, suggest how to use it.' },
  { label: 'Reading list reviewer', description: 'Review reading list changes', trigger: 'reading-list-changed', prompt: 'The reading list was updated. Check the current reading list items, summarize any new additions, and suggest which to read next based on my interests.' },
  { label: 'Away report', description: 'Generate a report when I return from idle', trigger: 'idle-changed', filter: 'active', prompt: 'The user just returned from being away. Check what tabs are open, review any pending messages from other agents, and provide a quick summary of what might need attention.' },
  { label: 'Summarize this page', description: 'Summarize page content from context menu', trigger: 'context-menu', filter: 'Summarize this page', prompt: 'Read and summarize the content that was shared with you.' },
  { label: 'Explain this', description: 'Explain selected text from context menu', trigger: 'context-menu', filter: 'Explain this', prompt: 'Explain the selected text in simple terms.' },
  { label: 'Save to memory', description: 'Save content to memories from context menu', trigger: 'context-menu', filter: 'Save to memory', prompt: 'Save the shared content to your memories with appropriate categorization.' },
];

@customElement('chaos-hooks-view')
export class ChaosHooksView extends SignalWatcher(LitElement) {
  createRenderRoot() { return this; }

  protected watchSignals() { return [hooksSignal]; }

  @property({ type: Array }) agents: AgentMeta[] = [];
  @property({ type: String }) activeAgentId: string | null = null;

  @state() private _hooks: Hook[] = [];
  @state() private _showForm = false;
  @state() private _editingHookId: string | null = null;

  // Form state
  @state() private _formDescription = '';
  @state() private _formTriggerType = 'bookmark-created';
  @state() private _formPrompt = '';
  @state() private _formAgentId = '';

  // Trigger-specific filter values
  @state() private _filterUrlPattern = '';
  @state() private _filterFilename = '';
  @state() private _filterIdleState = 'active';
  @state() private _filterKeyword = '';
  @state() private _filterLabel = '';
  @state() private _filterFolderId = '';
  @state() private _filterFolderName = '';
  @state() private _filterFsPath = '';
  @state() private _bookmarkFolders: Array<{ id: string; title: string; depth: number }> = [];

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-hooks-view] connected');
  }

  async refresh(): Promise<void> {
    console.log('[chaos-hooks-view] refresh');
    await refreshHooks();
  }

  /** Called from app.ts when a getHooks response comes back via port */
  setHooks(hooks: Hook[]): void {
    this._hooks = hooks;
    hooksSignal.value = hooks;
  }

  private _agentName(agentId: string): string {
    const agent = this.agents.find(a => a.id === agentId);
    return agent ? agent.name : agentId.slice(0, 12);
  }

  private _defaultAgentId(): string {
    const master = this.agents.find(a => a.master);
    return this._formAgentId || master?.id || this.activeAgentId || '';
  }

  private _resetForm(): void {
    this._formDescription = '';
    this._formTriggerType = 'bookmark-created';
    this._formPrompt = '';
    this._formAgentId = '';
    this._filterUrlPattern = '';
    this._filterFilename = '';
    this._filterIdleState = 'active';
    this._filterKeyword = '';
    this._filterLabel = '';
    this._filterFolderId = '';
    this._filterFolderName = '';
    this._filterFsPath = '';
    this._editingHookId = null;
  }

  private _applyPreset(preset: typeof HOOK_PRESETS[0]): void {
    this._formDescription = preset.description;
    this._formTriggerType = preset.trigger;
    this._formPrompt = preset.prompt;
    this._showForm = true;

    if (preset.filter) {
      // Set the appropriate filter for the trigger type
      switch (preset.trigger) {
        case 'tab-navigated':
        case 'history-visited':
          this._filterUrlPattern = preset.filter;
          break;
        case 'download-completed':
          this._filterFilename = preset.filter;
          break;
        case 'idle-changed':
          this._filterIdleState = preset.filter;
          break;
        case 'omnibox':
          this._filterKeyword = preset.filter;
          break;
        case 'context-menu':
          this._filterLabel = preset.filter;
          break;
      }
    }
  }

  private _editHook(hook: Hook): void {
    this._formDescription = hook.description;
    this._formTriggerType = hook.trigger.type;
    this._formPrompt = hook.prompt;
    this._formAgentId = hook.agentId;
    this._editingHookId = hook.id;
    this._showForm = true;

    // Fill trigger-specific filters
    if ('urlPattern' in hook.trigger) this._filterUrlPattern = (hook.trigger as { urlPattern: string }).urlPattern;
    if ('folderId' in hook.trigger) this._filterFolderId = (hook.trigger as { folderId?: string }).folderId || '';
    if ('folderName' in hook.trigger) this._filterFolderName = (hook.trigger as { folderName?: string }).folderName || '';
    if ('filenamePattern' in hook.trigger) this._filterFilename = (hook.trigger as { filenamePattern?: string }).filenamePattern || '';
    if ('state' in hook.trigger) this._filterIdleState = (hook.trigger as { state: string }).state;
    if ('keyword' in hook.trigger) this._filterKeyword = (hook.trigger as { keyword: string }).keyword;
    if ('label' in hook.trigger) this._filterLabel = (hook.trigger as { label: string }).label;
    if ('path' in hook.trigger) this._filterFsPath = (hook.trigger as { path?: string }).path || '';

    // Load bookmark folders if needed
    if (hook.trigger.type === 'bookmark-created') {
      this._loadBookmarkFolders();
    }
  }

  private async _toggleHook(hookId: string, currentlyEnabled: boolean): Promise<void> {
    sendPortMessage({ type: 'updateHook', hookId, updates: { enabled: !currentlyEnabled } });
    // Allow background to process, then refresh signal
    await new Promise(r => setTimeout(r, 100));
    await refreshHooks();
  }

  private async _deleteHook(hookId: string): Promise<void> {
    sendPortMessage({ type: 'removeHook', hookId });
    // Allow background to process, then refresh signal
    await new Promise(r => setTimeout(r, 100));
    await refreshHooks();
  }

  private async _loadBookmarkFolders(): Promise<void> {
    try {
      const hasBm = await chrome.permissions.contains({ permissions: ['bookmarks'] });
      if (!hasBm) {
        this._bookmarkFolders = [];
        return;
      }
      const tree = await chrome.bookmarks.getTree();
      const folders: Array<{ id: string; title: string; depth: number }> = [];
      function walkFolders(nodes: chrome.bookmarks.BookmarkTreeNode[], depth: number) {
        for (const node of nodes) {
          if (node.children) {
            folders.push({ id: node.id, title: node.title || '(root)', depth });
            walkFolders(node.children, depth + 1);
          }
        }
      }
      walkFolders(tree, 0);
      this._bookmarkFolders = folders;
    } catch {
      this._bookmarkFolders = [];
    }
  }

  private _onTriggerTypeChange(type: string): void {
    this._formTriggerType = type;
    // Reset filter values
    this._filterUrlPattern = '';
    this._filterFilename = '';
    this._filterIdleState = 'active';
    this._filterKeyword = '';
    this._filterLabel = '';
    this._filterFolderId = '';
    this._filterFolderName = '';
    this._filterFsPath = '';

    if (type === 'bookmark-created') {
      this._loadBookmarkFolders();
    }
  }

  private _saveHook(): void {
    if (!this.activeAgentId) return;

    const description = this._formDescription.trim();
    const prompt = this._formPrompt.trim();
    if (!description || !prompt) return;

    let trigger: HookTrigger;

    switch (this._formTriggerType) {
      case 'bookmark-created':
        trigger = {
          type: 'bookmark-created',
          folderId: this._filterFolderId || undefined,
          folderName: this._filterFolderName || undefined,
        };
        break;
      case 'tab-navigated':
        trigger = { type: 'tab-navigated', urlPattern: this._filterUrlPattern || '*' };
        break;
      case 'tab-created':
        trigger = { type: 'tab-created' };
        break;
      case 'tab-closed':
        trigger = { type: 'tab-closed' };
        break;
      case 'download-completed':
        trigger = { type: 'download-completed', filenamePattern: this._filterFilename || undefined };
        break;
      case 'history-visited':
        trigger = { type: 'history-visited', urlPattern: this._filterUrlPattern || '*' };
        break;
      case 'idle-changed':
        trigger = { type: 'idle-changed', state: this._filterIdleState as 'active' | 'idle' | 'locked' };
        break;
      case 'browser-startup':
        trigger = { type: 'browser-startup' };
        break;
      case 'omnibox':
        if (!this._filterKeyword.trim()) return;
        trigger = { type: 'omnibox', keyword: this._filterKeyword.trim() };
        break;
      case 'context-menu':
        if (!this._filterLabel.trim()) return;
        trigger = { type: 'context-menu', label: this._filterLabel.trim() };
        break;
      case 'reading-list-changed':
        trigger = { type: 'reading-list-changed' };
        break;
      case 'window-created':
        trigger = { type: 'window-created' };
        break;
      case 'window-focused':
        trigger = { type: 'window-focused' };
        break;
      case 'window-closed':
        trigger = { type: 'window-closed' };
        break;
      case 'clipboard-changed':
        trigger = { type: 'clipboard-changed' };
        break;
      case 'filesystem-changed':
        if (!this._filterFsPath.trim()) return;
        trigger = { type: 'filesystem-changed', path: this._filterFsPath.trim() };
        break;
      default:
        return;
    }

    const hookAgentId = this._formAgentId || this.agents.find(a => a.master)?.id || this.activeAgentId;

    if (this._editingHookId) {
      sendPortMessage({
        type: 'updateHook',
        hookId: this._editingHookId,
        updates: { agentId: hookAgentId, trigger, prompt, description },
      });
    } else {
      const hook: Hook = {
        id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: hookAgentId!,
        trigger,
        prompt,
        description,
        enabled: true,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
      };
      sendPortMessage({ type: 'addHook', hook });
    }

    this._resetForm();
    this._showForm = false;
    // Allow background to process, then refresh signal
    setTimeout(() => refreshHooks(), 100);
  }

  private _onRefinePrompt(): void {
    // Delegate to the existing global refine modal in app.html
    const refineModal = document.getElementById('refine-modal');
    const refineOriginal = document.getElementById('refine-original');
    const refineResult = document.getElementById('refine-result') as HTMLTextAreaElement | null;
    const refineLoading = document.getElementById('refine-loading');
    const refineAcceptBtn = document.getElementById('refine-accept') as HTMLButtonElement | null;

    if (!refineModal || !refineOriginal || !refineResult || !refineLoading || !refineAcceptBtn) return;

    const prompt = this._formPrompt.trim();
    if (!prompt) return;

    refineOriginal.textContent = prompt;
    refineResult.value = '';
    refineResult.style.display = 'none';
    refineLoading.style.display = 'flex';
    refineAcceptBtn.disabled = true;
    refineModal.classList.add('visible');

    const context = `Hook prompt for a "${this._formTriggerType}" trigger`;

    sendMsg<{ refined?: string; error?: string }>({ type: 'refinePrompt', prompt, context })
      .then(resp => {
        refineLoading.style.display = 'none';
        if (resp.refined) {
          refineResult.value = resp.refined;
          refineResult.style.display = '';
          refineAcceptBtn.disabled = false;
        } else {
          refineResult.value = '(Failed to refine prompt)';
          refineResult.style.display = '';
        }
      })
      .catch(err => {
        refineLoading.style.display = 'none';
        refineResult.value = `(Error: ${err instanceof Error ? err.message : 'Failed to refine prompt. Check your API key in Global Settings.'})`;
        refineResult.style.display = '';
      });

    // Listen for accept — update our form state
    const onAccept = () => {
      if (refineResult.value) {
        this._formPrompt = refineResult.value;
      }
      refineAcceptBtn.removeEventListener('click', onAccept);
    };
    refineAcceptBtn.addEventListener('click', onAccept);
  }

  private async _pickDirectory(): Promise<void> {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      if (handle) {
        this._filterFsPath = handle.name;
        (window as any).__chaosLastPickedDirHandle = handle;
        console.log('[hooks] Directory handle picked:', handle.name);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[hooks] Directory picker failed:', err);
      }
    }
  }

  render() {
    return html`
      <div class="view-padded">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h2>Hooks</h2>
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <button class="btn btn-primary btn-sm" @click=${() => { this._showForm = !this._showForm; if (this._showForm && !this._editingHookId) this._resetForm(); }}>+ Create Hook</button>
          </div>
        </div>

        ${this._renderPresets()}
        ${this._showForm ? this._renderForm() : nothing}
        ${this._renderHooksList()}
      </div>
    `;
  }

  private _renderPresets() {
    return html`
      <div style="margin-bottom:16px;">
        <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-2);">Quick start with a preset, or create your own below.</p>
        <div style="display:flex;flex-wrap:wrap;gap:var(--sp-2);">
          ${HOOK_PRESETS.map(p => html`
            <button class="btn btn-ghost btn-sm" style="font-size:var(--text-xs);" @click=${() => this._applyPreset(p)}>
              ${escapeHtml(p.label)}
            </button>
          `)}
        </div>
      </div>
    `;
  }

  private _renderForm() {
    // Sort agents: master first, then alphabetical
    const sortedAgents = [...this.agents].sort((a, b) => {
      if (a.master && !b.master) return -1;
      if (!a.master && b.master) return 1;
      return a.name.localeCompare(b.name);
    });

    return html`
      <div style="margin-bottom:16px;">
        <div class="settings-card">
          <h3>${this._editingHookId ? 'Edit Hook' : 'New Hook'}</h3>
          <div class="settings-field">
            <label>Description</label>
            <input type="text" placeholder="e.g. Summarize bookmarked articles"
              .value=${this._formDescription}
              @input=${(e: Event) => { this._formDescription = (e.target as HTMLInputElement).value; }}>
          </div>
          <div class="settings-field">
            <label>Trigger</label>
            <select .value=${this._formTriggerType} @change=${(e: Event) => { this._onTriggerTypeChange((e.target as HTMLSelectElement).value); }}>
              <option value="bookmark-created">Bookmark Created</option>
              <option value="tab-navigated">Tab Navigated to URL</option>
              <option value="tab-created">Tab Created</option>
              <option value="tab-closed">Tab Closed</option>
              <option value="download-completed">Download Completed</option>
              <option value="history-visited">Page Visited (History)</option>
              <option value="idle-changed">Idle State Changed</option>
              <option value="browser-startup">Browser Startup</option>
              <option value="omnibox">Omnibox Command</option>
              <option value="reading-list-changed">Reading List Changed</option>
              <option value="window-created">Window Created</option>
              <option value="window-focused">Window Focused</option>
              <option value="window-closed">Window Closed</option>
              <option value="context-menu">Context Menu</option>
              <option value="clipboard-changed">Clipboard Changed</option>
              <option value="filesystem-changed">File System Changed</option>
            </select>
          </div>

          ${this._renderTriggerFilters()}

          <div class="settings-field">
            <label>Assign to Agent</label>
            <select .value=${this._formAgentId || this._defaultAgentId()} @change=${(e: Event) => { this._formAgentId = (e.target as HTMLSelectElement).value; }}>
              ${sortedAgents.map(a => html`
                <option value=${a.id} ?selected=${a.master && !this._formAgentId}>${a.name}${a.master ? ' (master)' : ''}</option>
              `)}
            </select>
          </div>

          <div class="settings-field">
            <label>Prompt</label>
            <p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-2);">Tell the agent what to do when this event fires. Be specific, the agent will execute this as a full task with access to all its tools.</p>
            <div class="prompt-textarea-wrapper">
              <textarea rows="6"
                placeholder="e.g. Read the bookmarked page content, write a summary to memories/bookmarks/, and update TODO.md if there are any action items."
                style="width:100%;background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-default);border-radius:8px;padding:var(--sp-3);font-family:var(--font-sans);font-size:var(--text-sm);resize:vertical;min-height:100px;max-height:300px;line-height:1.5;outline:none;transition:border-color var(--duration-fast) var(--ease-out);"
                .value=${this._formPrompt}
                @input=${(e: Event) => { this._formPrompt = (e.target as HTMLTextAreaElement).value; }}></textarea>
              <button type="button" class="refine-prompt-btn" title="Refine prompt with AI" @click=${() => this._onRefinePrompt()}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"/></svg>
                Refine
              </button>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-primary btn-sm" @click=${() => this._saveHook()}>Save Hook</button>
            <button class="btn btn-ghost btn-sm" @click=${() => { this._showForm = false; this._editingHookId = null; }}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderTriggerFilters() {
    switch (this._formTriggerType) {
      case 'bookmark-created':
        return html`
          <div class="settings-field">
            <label>Bookmark Folder (optional, watch a specific folder)</label>
            <select @change=${(e: Event) => {
              const sel = e.target as HTMLSelectElement;
              this._filterFolderId = sel.value;
              this._filterFolderName = sel.selectedOptions[0]?.dataset.name || '';
            }}>
              <option value="">Any folder</option>
              ${this._bookmarkFolders.map(f => html`
                <option value=${f.id} data-name=${f.title} ?selected=${this._filterFolderId === f.id}>
                  ${'  '.repeat(f.depth)}${escapeHtml(f.title)}
                </option>
              `)}
            </select>
          </div>
        `;
      case 'tab-navigated':
      case 'history-visited':
        return html`
          <div class="settings-field">
            <label>URL Pattern (glob, e.g. *github.com/*)</label>
            <input type="text" placeholder="*.example.com/*"
              .value=${this._filterUrlPattern}
              @input=${(e: Event) => { this._filterUrlPattern = (e.target as HTMLInputElement).value; }}>
          </div>
        `;
      case 'download-completed':
        return html`
          <div class="settings-field">
            <label>Filename Pattern (optional, e.g. *.pdf)</label>
            <input type="text" placeholder="*.pdf"
              .value=${this._filterFilename}
              @input=${(e: Event) => { this._filterFilename = (e.target as HTMLInputElement).value; }}>
          </div>
        `;
      case 'idle-changed':
        return html`
          <div class="settings-field">
            <label>State</label>
            <select .value=${this._filterIdleState} @change=${(e: Event) => { this._filterIdleState = (e.target as HTMLSelectElement).value; }}>
              <option value="active">Active</option>
              <option value="idle">Idle</option>
              <option value="locked">Locked</option>
            </select>
          </div>
        `;
      case 'omnibox':
        return html`
          <div class="settings-field">
            <label>Keyword (text after "chaos " in address bar)</label>
            <input type="text" placeholder="e.g. summarize"
              .value=${this._filterKeyword}
              @input=${(e: Event) => { this._filterKeyword = (e.target as HTMLInputElement).value; }}>
          </div>
        `;
      case 'context-menu':
        return html`
          <div class="settings-field">
            <label>Menu Item Label</label>
            <input type="text" placeholder="e.g. Summarize this page"
              .value=${this._filterLabel}
              @input=${(e: Event) => { this._filterLabel = (e.target as HTMLInputElement).value; }}>
          </div>
        `;
      case 'filesystem-changed':
        return html`
          <div class="settings-field">
            <label>Directory to Watch</label>
            <div style="display:flex;gap:var(--sp-2);align-items:center;">
              <input type="text" placeholder="Click 'Pick Directory' to choose" readonly style="flex:1;"
                .value=${this._filterFsPath}>
              <button class="btn btn-ghost btn-xs" @click=${() => this._pickDirectory()}>Pick Directory</button>
            </div>
            <p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">Uses the File System Access API to watch a local directory for changes.</p>
          </div>
        `;
      default:
        return nothing;
    }
  }

  private _renderHooksList() {
    const hooks = this._hooks;

    if (hooks.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <h3>No hooks</h3>
          <p>Hooks let your agent respond to browser events automatically. Create one to get started, or ask your agent to set up hooks via chat.</p>
        </div>
      `;
    }

    return html`
      ${hooks.map(hook => {
        const triggerLabel = formatTrigger(hook.trigger);
        const lastTriggered = hook.lastTriggeredAt ? relativeTime(hook.lastTriggeredAt) : 'never';

        return html`
          <div class="settings-card" style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <strong>${escapeHtml(hook.description)}</strong>
                  <span class="badge" style="background:${hook.enabled ? 'var(--success-subtle)' : 'var(--danger-subtle)'};color:${hook.enabled ? 'var(--success-text)' : 'var(--danger-text)'};">${hook.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div style="color:var(--text-secondary);font-size:var(--text-sm);">
                  <span style="font-weight:500;">Trigger:</span> ${escapeHtml(triggerLabel)}
                  &middot; <span style="font-weight:500;">Agent:</span> ${escapeHtml(this._agentName(hook.agentId))}
                </div>
                <div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:4px;">
                  Fired ${hook.triggerCount} time${hook.triggerCount !== 1 ? 's' : ''} &middot; Last: ${escapeHtml(lastTriggered)}
                </div>
                <details style="margin-top:6px;">
                  <summary style="font-size:var(--text-xs);color:var(--accent-text);cursor:pointer;user-select:none;">Show prompt</summary>
                  <div style="margin-top:4px;padding:8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:var(--text-xs);white-space:pre-wrap;word-break:break-word;color:var(--text-secondary);max-height:150px;overflow-y:auto;">${escapeHtml(hook.prompt)}</div>
                </details>
              </div>
              <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                <button class="btn btn-ghost btn-sm" title="Edit hook" @click=${() => this._editHook(hook)}>Edit</button>
                <button class="btn btn-ghost btn-sm" title="${hook.enabled ? 'Disable' : 'Enable'}" @click=${() => this._toggleHook(hook.id, hook.enabled)}>${hook.enabled ? 'Disable' : 'Enable'}</button>
                <button class="btn btn-ghost btn-sm" title="Delete hook" style="color:var(--danger-text);" @click=${() => this._deleteHook(hook.id)}>Delete</button>
              </div>
            </div>
          </div>
        `;
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-hooks-view': ChaosHooksView;
  }
}
