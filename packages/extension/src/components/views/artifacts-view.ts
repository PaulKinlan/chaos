/**
 * `<chaos-artifacts-view>` — Artifacts grid and detail modal.
 *
 * Shows agent filter, text search, artifact grid with type badges and
 * pin indicators. Click to show detail modal with secure viewer.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';
import { createSecureViewer, detectContentType, type SecureViewer } from '../../ui/secure-viewer.js';
import type { AgentMeta, ArtifactMeta } from '../../storage/types.js';

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

@customElement('chaos-artifacts-view')
export class ChaosArtifactsView extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Array }) agents: AgentMeta[] = [];

  @state() private _artifacts: ArtifactMeta[] = [];
  @state() private _filterAgentId = '';
  @state() private _searchQuery = '';
  @state() private _loading = false;

  // Detail modal state
  @state() private _detailArtifact: ArtifactMeta | null = null;
  @state() private _detailContent = '';
  @state() private _detailOpen = false;

  private _activeSecureViewer: SecureViewer | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-artifacts-view] connected');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._activeSecureViewer) {
      this._activeSecureViewer.destroy();
      this._activeSecureViewer = null;
    }
  }

  private _agentName(agentId: string): string {
    const agent = this.agents.find(a => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  async refresh(): Promise<void> {
    console.log('[chaos-artifacts-view] refresh');
    this._loading = true;
    try {
      const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
      this._artifacts = result.artifacts;
    } catch (err) {
      console.error('[chaos-artifacts-view] Error loading artifacts:', err);
    } finally {
      this._loading = false;
    }
  }

  private get _filtered(): ArtifactMeta[] {
    let filtered = this._filterAgentId
      ? this._artifacts.filter(a => a.agentId === this._filterAgentId)
      : [...this._artifacts];

    const q = this._searchQuery.toLowerCase().trim();
    if (q) {
      filtered = filtered.filter(a => {
        const name = (a.title || a.path.split('/').pop() || a.path).toLowerCase();
        const desc = a.description.toLowerCase();
        const tags = (a.tags || []).join(' ').toLowerCase();
        return name.includes(q) || desc.includes(q) || tags.includes(q);
      });
    }

    // Sort: pinned first, then by timestamp descending
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return filtered;
  }

  /** Public method so other components can show an artifact detail */
  async showDetail(artifact: ArtifactMeta): Promise<void> {
    return this._showDetail(artifact);
  }

  private async _showDetail(artifact: ArtifactMeta): Promise<void> {
    // Destroy any previous secure viewer
    if (this._activeSecureViewer) {
      this._activeSecureViewer.destroy();
      this._activeSecureViewer = null;
    }

    let fileContent = '(Unable to read file content)';
    try {
      const result = await sendMsg<{ content: string }>({
        type: 'readArtifactContent',
        path: artifact.path,
      });
      if (result?.content) {
        fileContent = result.content;
      } else {
        // Try reading from agent-scoped path as fallback
        try {
          const agentResult = await sendMsg<{ content: string }>({
            type: 'readArtifactContent',
            path: `agents/${artifact.agentId}/${artifact.path}`,
          });
          if (agentResult?.content) fileContent = agentResult.content;
        } catch { /* fallback failed too */ }
      }
    } catch (err) {
      console.error('[chaos-artifacts-view] Failed to read artifact content:', artifact.path, err);
    }

    this._detailArtifact = artifact;
    this._detailContent = fileContent;
    this._detailOpen = true;

    // Wait for render, then create the secure viewer
    await this.updateComplete;
    const viewerContainer = this.querySelector('#chaos-artifact-viewer-container') as HTMLElement;
    if (viewerContainer) {
      const contentType = artifact.type && artifact.type !== 'webpage' && artifact.type !== 'image'
        ? artifact.type as 'html' | 'markdown' | 'text' | 'json' | 'csv'
        : artifact.type === 'webpage' ? 'html' : detectContentType(artifact.path);

      const filename = artifact.path.split('/').pop() || artifact.path;
      const displayTitle = artifact.title || filename;

      this._activeSecureViewer = createSecureViewer(viewerContainer, fileContent, {
        type: contentType,
        title: displayTitle,
        downloadFilename: filename,
      });
    }
  }

  private _closeDetail(): void {
    if (this._activeSecureViewer) {
      this._activeSecureViewer.destroy();
      this._activeSecureViewer = null;
    }
    this._detailOpen = false;
    this._detailArtifact = null;
  }

  private async _togglePin(artifact: ArtifactMeta): Promise<void> {
    const newPinned = !artifact.pinned;
    await sendMsg({ type: 'updateArtifactMeta', artifactPath: artifact.path, updates: { pinned: newPinned } });
    artifact.pinned = newPinned;
    this.requestUpdate();
    // Refresh the list
    await this.refresh();
  }

  private _downloadArtifact(): void {
    if (!this._detailArtifact) return;
    const filename = this._detailArtifact.path.split('/').pop() || this._detailArtifact.path;
    const blob = new Blob([this._detailContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async _deleteArtifact(artifactPath: string): Promise<void> {
    // Use the global confirm dialog
    const overlay = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) return;

    titleEl.textContent = 'Delete Artifact';
    msgEl.textContent = 'Delete this artifact? This cannot be undone.';
    overlay.classList.add('visible');

    const cleanup = () => {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onOk = async () => {
      cleanup();
      await sendMsg({ type: 'deleteArtifact', artifactPath });
      await this.refresh();
    };

    const onCancel = () => {
      cleanup();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  }

  render() {
    const filtered = this._filtered;
    const pinSvg = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>`;

    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2>Artifacts</h2>
        </div>
        <div class="filter-bar">
          <select .value=${this._filterAgentId} @change=${(e: Event) => { this._filterAgentId = (e.target as HTMLSelectElement).value; }}>
            <option value="">All agents</option>
            ${this.agents.map(a => html`
              <option value=${a.id}>${a.name}${a.master ? ' \u2605' : ''}</option>
            `)}
          </select>
          <input type="text" placeholder="Search artifacts..." .value=${this._searchQuery} @input=${(e: Event) => { this._searchQuery = (e.target as HTMLInputElement).value; }}>
        </div>

        ${this._loading ? html`
          <div class="panel-spinner"><div class="spinner"></div><span>Loading...</span></div>
        ` : nothing}

        ${filtered.length === 0 && !this._loading ? html`
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <h3>No artifacts</h3>
            <p>${this._searchQuery
              ? 'No artifacts match your search.'
              : 'No shared artifacts yet. Artifacts are files that an agent publishes to the shared space for other agents to read. Ask an agent to "publish" or "share" a file, and it will appear here.'}</p>
          </div>
        ` : nothing}

        <div class="artifact-grid">
          ${filtered.map((a) => {
            const typeLabel = artifactTypeLabel(a);
            const badgeClass = artifactTypeBadgeClass(typeLabel);
            const displayName = a.title || a.path.split('/').pop() || a.path;
            return html`
              <div class="artifact-card" style="cursor:pointer;" @click=${() => this._showDetail(a)}>
                <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-1);">
                  ${a.pinned ? html`<span class="pin-indicator" title="Pinned">${pinSvg}</span>` : nothing}
                  <span class="badge ${badgeClass}" style="font-size:10px;">${escapeHtml(typeLabel)}</span>
                </div>
                <div class="artifact-card-name">${escapeHtml(displayName)}</div>
                <div class="artifact-card-desc">${escapeHtml(a.description)}</div>
                <div class="artifact-card-meta">
                  <span class="artifact-agent-label">${escapeHtml(this._agentName(a.agentId))}</span>
                  <span>${formatTime(a.timestamp)}</span>
                </div>
                <button class="btn btn-ghost btn-xs delete-artifact-btn" title="Delete artifact"
                  style="position:absolute;top:6px;right:6px;color:var(--text-muted);"
                  @click=${(e: Event) => { e.stopPropagation(); this._deleteArtifact(a.path); }}>&#x2715;</button>
              </div>
            `;
          })}
        </div>
      </div>

      ${this._renderDetailModal()}
    `;
  }

  private _renderDetailModal() {
    if (!this._detailOpen || !this._detailArtifact) return nothing;

    const artifact = this._detailArtifact;
    const filename = artifact.path.split('/').pop() || artifact.path;
    const displayTitle = artifact.title || filename;
    const typeLabel = artifactTypeLabel(artifact);
    const pinSvgOutline = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>`;
    const pinSvgFilled = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>`;
    const downloadSvg = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    return html`
      <div class="modal-overlay visible" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeDetail(); }}>
        <div class="modal">
          <button class="modal-close" @click=${() => this._closeDetail()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div>
            <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3);">
              <h2 style="flex:1;margin:0;">${escapeHtml(displayTitle)}</h2>
              <span class="badge ${artifactTypeBadgeClass(typeLabel)}" style="font-size:10px;">${escapeHtml(typeLabel)}</span>
              <button class="btn btn-ghost btn-xs" title="${artifact.pinned ? 'Unpin' : 'Pin'}"
                style="color:${artifact.pinned ? 'var(--accent)' : 'var(--text-muted)'};"
                @click=${() => this._togglePin(artifact)}>
                ${artifact.pinned ? pinSvgFilled : pinSvgOutline}
              </button>
              <button class="btn btn-ghost btn-xs" title="Download" @click=${() => this._downloadArtifact()}>
                ${downloadSvg}
              </button>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Description</div>
              <div class="task-detail-value">${escapeHtml(artifact.description)}</div>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Producer</div>
              <div class="task-detail-value">${escapeHtml(this._agentName(artifact.agentId))}</div>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Path</div>
              <div class="task-detail-value" style="font-family:var(--font-mono);font-size:var(--text-xs);">
                ${escapeHtml(artifact.path)}
              </div>
            </div>
            <div class="task-detail-field">
              <div class="task-detail-label">Created</div>
              <div class="task-detail-value">${formatTimeFull(artifact.timestamp)}</div>
            </div>
            ${artifact.tags && artifact.tags.length > 0 ? html`
              <div class="task-detail-field">
                <div class="task-detail-label">Tags</div>
                <div class="task-detail-value">
                  ${artifact.tags.map(t => html`<span class="badge badge-gray" style="margin-right:4px;">${escapeHtml(t)}</span>`)}
                </div>
              </div>
            ` : nothing}
            <div class="task-detail-field">
              <div class="task-detail-label">Content</div>
              <div class="secure-viewer-container" id="chaos-artifact-viewer-container"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-artifacts-view': ChaosArtifactsView;
  }
}
