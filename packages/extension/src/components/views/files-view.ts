/**
 * `<chaos-files-view>` — Agent memory file browser.
 *
 * Shows a file tree on the left and file content on the right.
 * Supports markdown rendering, JSONL formatting, and raw text display.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ── Types ──

interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

@customElement('chaos-files-view')
export class ChaosFilesView extends LitElement {
  createRenderRoot() { return this; }

  /** Currently selected agent ID — set by the parent. */
  @property({ type: String, attribute: 'active-agent-id' }) activeAgentId: string | null = null;

  @state() private _files: FileEntry[] = [];
  @state() private _loading = false;
  @state() private _error = '';
  @state() private _selectedFileName = '';
  @state() private _selectedFilePath: string | null = null;
  @state() private _fileContent: string | null = null;
  @state() private _fileRenderedHtml = '';
  @state() private _fileViewMode: 'raw' | 'markdown' | 'jsonl' = 'raw';
  @state() private _selectedTreePath: string | null = null;

  private _lastAgentId: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-files-view] connected');
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    // Re-fetch files when agent changes
    if (changedProperties.has('activeAgentId') && this.activeAgentId !== this._lastAgentId) {
      this._lastAgentId = this.activeAgentId;
      // Reset state for the new agent
      this._files = [];
      this._selectedFileName = '';
      this._selectedFilePath = null;
      this._fileContent = null;
      this._fileRenderedHtml = '';
      this._selectedTreePath = null;
      this._error = '';
      // Fetch new agent's files
      this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (!this.activeAgentId) {
      console.log('[chaos-files-view] no active agent, skipping refresh');
      return;
    }

    console.log('[chaos-files-view] refresh, activeAgentId=', this.activeAgentId);
    this._loading = true;
    this._error = '';
    this._selectedFileName = '';
    this._selectedFilePath = null;
    this._fileContent = null;
    this._fileRenderedHtml = '';
    this._selectedTreePath = null;

    try {
      const result = await sendMsg<{ files: FileEntry[] }>({ type: 'listAgentFiles', agentId: this.activeAgentId });
      this._files = result.files;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      console.error('[chaos-files-view] Error listing files:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadFileContent(filePath: string, fileName: string): Promise<void> {
    if (!this.activeAgentId) return;

    this._selectedFileName = fileName;
    this._selectedFilePath = filePath;
    this._selectedTreePath = filePath;

    try {
      const result = await sendMsg<{ content: string }>({ type: 'readAgentFile', agentId: this.activeAgentId, path: filePath });

      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      // Batch state updates to avoid Lit DOM diffing issues
      if (ext === 'md') {
        const rawHtml = marked.parse(result.content) as string;
        this._fileViewMode = 'markdown';
        this._fileRenderedHtml = DOMPurify.sanitize(rawHtml);
        this._fileContent = result.content;
      } else if (ext === 'jsonl') {
        const lines = result.content.split('\n').filter((l) => l.trim());
        const html = lines
          .map((line) => {
            try {
              const parsed = JSON.parse(line);
              return `<div class="files-jsonl-entry">${escapeHtml(JSON.stringify(parsed, null, 2))}</div>`;
            } catch {
              return `<div class="files-jsonl-entry">${escapeHtml(line)}</div>`;
            }
          })
          .join('');
        this._fileViewMode = 'jsonl';
        this._fileRenderedHtml = html;
        this._fileContent = result.content;
      } else {
        this._fileViewMode = 'raw';
        this._fileRenderedHtml = '';
        this._fileContent = result.content;
      }
    } catch (err) {
      this._fileContent = `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      this._fileViewMode = 'raw';
      console.error('[chaos-files-view] Error reading file:', err);
    }
  }

  private _downloadFile(): void {
    if (!this._fileContent || !this._selectedFilePath) return;
    const fileName = this._selectedFilePath.split('/').pop() || 'file';
    const blob = new Blob([this._fileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  render() {
    return html`
      <div class="files-container">
        <div class="files-tree-panel">
          <div class="files-tree-header">Agent Memory</div>
          <div class="files-tree">
            ${this._loading ? html`<p style="color:var(--text-muted);padding:12px;">Loading...</p>` : nothing}
            ${this._error ? html`<p style="color:var(--danger-text);padding:12px;">Error: ${this._error}</p>` : nothing}
            ${!this._loading && !this._error && this._files.length === 0
              ? html`<div class="empty-state" style="padding:24px;"><p>${this.activeAgentId ? 'No files found for this agent.' : 'Select an agent to browse its files.'}</p></div>`
              : nothing}
            ${!this._loading && !this._error ? this._renderTree(this._files, 0) : nothing}
          </div>
        </div>
        <div class="files-viewer-panel">
          <div class="files-viewer-header">
            <span class="filename">${this._selectedFileName || 'No file selected'}</span>
            ${this._fileContent !== null ? html`
              <button class="btn btn-ghost btn-sm" @click=${() => this._downloadFile()}>Download</button>
            ` : nothing}
          </div>
          <div class="files-viewer-content ${this._fileViewMode === 'markdown' ? 'markdown-view' : this._fileViewMode === 'raw' ? 'raw-view' : ''}">
            ${this._fileContent === null
              ? html`<div class="files-viewer-empty">Select a file to view its contents.</div>`
              : this._fileViewMode === 'raw'
                ? this._fileContent
                : nothing
            }
          </div>
        </div>
      </div>
    `;
  }

  updated() {
    // For markdown and jsonl, we need to set innerHTML since the content is sanitized HTML
    if (this._fileRenderedHtml && (this._fileViewMode === 'markdown' || this._fileViewMode === 'jsonl')) {
      const viewer = this.querySelector('.files-viewer-content');
      if (viewer) {
        viewer.innerHTML = this._fileRenderedHtml;
      }
    }
  }

  private _renderTree(entries: FileEntry[], depth: number): unknown {
    if (entries.length === 0) return nothing;

    const sorted = [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map((entry) => {
      const indentClass = depth === 1 ? ' files-indent' : depth === 2 ? ' files-indent-2' : depth >= 3 ? ' files-indent-3' : '';
      const isSelected = this._selectedTreePath === entry.path;

      const icon = entry.kind === 'directory'
        ? html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        : html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

      const sizeStr = entry.size !== undefined ? formatFileSize(entry.size) : '';

      return html`
        <div class="files-tree-item${entry.kind === 'directory' ? ' directory' : ''}${indentClass}${isSelected ? ' selected' : ''}"
          @click=${entry.kind === 'file' ? () => this._loadFileContent(entry.path, entry.name) : nothing}>
          <span class="icon">${icon}</span>
          <span class="name">${escapeHtml(entry.name)}</span>
          ${sizeStr ? html`<span class="size">${sizeStr}</span>` : nothing}
        </div>
        ${entry.kind === 'directory' && entry.children ? this._renderTree(entry.children, depth + 1) : nothing}
      `;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-files-view': ChaosFilesView;
  }
}
