/**
 * `<chaos-files-view>` — Agent memory file browser.
 *
 * Shows a file tree on the left and file content on the right.
 * Supports markdown rendering, JSONL formatting, and raw text display.
 * Files can be edited inline, deleted, moved/renamed, and added via drag-and-drop.
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
  @state() private _editing = false;
  @state() private _editContent = '';
  @state() private _saving = false;
  @state() private _dragOver = false;

  private _lastAgentId: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-files-view] connected');
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('activeAgentId') && this.activeAgentId !== this._lastAgentId) {
      this._lastAgentId = this.activeAgentId;
      this._files = [];
      this._selectedFileName = '';
      this._selectedFilePath = null;
      this._fileContent = null;
      this._fileRenderedHtml = '';
      this._selectedTreePath = null;
      this._error = '';
      this._editing = false;
      this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (!this.activeAgentId) return;

    this._loading = true;
    this._error = '';

    try {
      const result = await sendMsg<{ files: FileEntry[] }>({ type: 'listAgentFiles', agentId: this.activeAgentId });
      this._files = result.files;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadFileContent(filePath: string, fileName: string): Promise<void> {
    if (!this.activeAgentId) return;

    this._selectedFileName = fileName;
    this._selectedFilePath = filePath;
    this._selectedTreePath = filePath;
    this._editing = false;

    try {
      const result = await sendMsg<{ content: string }>({ type: 'readAgentFile', agentId: this.activeAgentId, path: filePath });
      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      if (ext === 'md') {
        const rawHtml = marked.parse(result.content) as string;
        this._fileViewMode = 'markdown';
        this._fileRenderedHtml = DOMPurify.sanitize(rawHtml);
        this._fileContent = result.content;
      } else if (ext === 'jsonl') {
        const lines = result.content.split('\n').filter((l) => l.trim());
        const htmlStr = lines
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
        this._fileRenderedHtml = htmlStr;
        this._fileContent = result.content;
      } else {
        this._fileViewMode = 'raw';
        this._fileRenderedHtml = '';
        this._fileContent = result.content;
      }
    } catch (err) {
      this._fileContent = `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      this._fileViewMode = 'raw';
    }
  }

  // ── Edit ──

  private _startEdit(): void {
    if (this._fileContent === null) return;
    this._editing = true;
    this._editContent = this._fileContent;
  }

  private _cancelEdit(): void {
    this._editing = false;
  }

  private async _saveEdit(): Promise<void> {
    if (!this.activeAgentId || !this._selectedFilePath) return;
    this._saving = true;
    try {
      await sendMsg({ type: 'writeAgentFile', agentId: this.activeAgentId, path: this._selectedFilePath, content: this._editContent });
      this._editing = false;
      // Reload the file to see changes
      await this._loadFileContent(this._selectedFilePath, this._selectedFileName);
    } catch (err) {
      console.error('[chaos-files-view] Save failed:', err);
    } finally {
      this._saving = false;
    }
  }

  // ── Delete ──

  private async _deleteFile(): Promise<void> {
    if (!this.activeAgentId || !this._selectedFilePath) return;
    if (!confirm(`Delete "${this._selectedFileName}"? This cannot be undone.`)) return;

    try {
      await sendMsg({ type: 'deleteAgentFile', agentId: this.activeAgentId, path: this._selectedFilePath });
      this._selectedFileName = '';
      this._selectedFilePath = null;
      this._fileContent = null;
      this._fileRenderedHtml = '';
      this._selectedTreePath = null;
      this._editing = false;
      await this.refresh();
    } catch (err) {
      console.error('[chaos-files-view] Delete failed:', err);
    }
  }

  // ── Move/Rename ──

  private async _moveFile(): Promise<void> {
    if (!this.activeAgentId || !this._selectedFilePath) return;
    const newPath = prompt('New path:', this._selectedFilePath);
    if (!newPath || newPath === this._selectedFilePath) return;

    try {
      await sendMsg({ type: 'moveAgentFile', agentId: this.activeAgentId, from: this._selectedFilePath, to: newPath });
      // Reload and select the new file
      await this.refresh();
      const newName = newPath.split('/').pop() || newPath;
      await this._loadFileContent(newPath, newName);
    } catch (err) {
      console.error('[chaos-files-view] Move failed:', err);
    }
  }

  // ── Download ──

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

  // ── Drag and Drop ──

  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    this._dragOver = true;
  }

  private _onDragLeave(): void {
    this._dragOver = false;
  }

  private async _onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    this._dragOver = false;

    if (!this.activeAgentId || !e.dataTransfer?.files?.length) return;

    for (const file of Array.from(e.dataTransfer.files)) {
      try {
        const content = await file.text();
        await sendMsg({
          type: 'writeAgentFile',
          agentId: this.activeAgentId,
          path: file.name,
          content,
        });
        console.log(`[chaos-files-view] Dropped file saved: ${file.name}`);
      } catch (err) {
        console.error(`[chaos-files-view] Failed to save dropped file ${file.name}:`, err);
      }
    }

    await this.refresh();
  }

  // ── Render ──

  render() {
    const fileSvg = html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const folderSvg = html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    return html`
      <div class="files-container"
        @dragover=${this._onDragOver}
        @dragleave=${this._onDragLeave}
        @drop=${this._onDrop}>
        ${this._dragOver ? html`
          <div style="position:absolute;inset:0;background:rgba(35,134,54,0.15);border:2px dashed var(--accent);border-radius:8px;z-index:10;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <span style="color:var(--accent);font-size:var(--text-base);font-weight:500;">Drop files to add to agent memory</span>
          </div>
        ` : nothing}
        <div class="files-tree-panel">
          <div class="files-tree-header">Agent Memory</div>
          <div class="files-tree">
            ${this._loading ? html`<p style="color:var(--text-muted);padding:12px;">Loading...</p>` : nothing}
            ${this._error ? html`<p style="color:var(--danger-text);padding:12px;">Error: ${this._error}</p>` : nothing}
            ${!this._loading && !this._error && this._files.length === 0
              ? html`<div class="empty-state" style="padding:24px;"><p>${this.activeAgentId ? 'No files yet. Drop files here or let the agent create them.' : 'Select an agent to browse its files.'}</p></div>`
              : nothing}
            ${!this._loading && !this._error ? this._renderTree(this._files, 0, fileSvg, folderSvg) : nothing}
          </div>
        </div>
        <div class="files-viewer-panel">
          <div class="files-viewer-header">
            <span class="filename">${this._selectedFileName || 'No file selected'}</span>
            ${this._fileContent !== null ? html`
              <div style="display:flex;gap:4px;">
                ${this._editing ? html`
                  <button class="btn btn-primary btn-sm" @click=${this._saveEdit} ?disabled=${this._saving}>
                    ${this._saving ? 'Saving...' : 'Save'}
                  </button>
                  <button class="btn btn-ghost btn-sm" @click=${this._cancelEdit}>Cancel</button>
                ` : html`
                  <button class="btn btn-ghost btn-sm" @click=${this._startEdit} title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-sm" @click=${this._moveFile} title="Move / Rename">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-sm" @click=${this._downloadFile} title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                  <button class="btn btn-ghost btn-sm" @click=${this._deleteFile} title="Delete" style="color:var(--danger-text);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                `}
              </div>
            ` : nothing}
          </div>
          <div class="files-viewer-content ${this._editing ? '' : this._fileViewMode === 'markdown' ? 'markdown-view' : this._fileViewMode === 'raw' ? 'raw-view' : ''}">
            ${this._editing
              ? html`<textarea
                  style="width:100%;height:100%;resize:none;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-default);border-radius:6px;padding:12px;font-family:monospace;font-size:13px;outline:none;"
                  .value=${this._editContent}
                  @input=${(e: Event) => { this._editContent = (e.target as HTMLTextAreaElement).value; }}
                ></textarea>`
              : this._fileContent === null
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
    if (!this._editing && this._fileRenderedHtml && (this._fileViewMode === 'markdown' || this._fileViewMode === 'jsonl')) {
      const viewer = this.querySelector('.files-viewer-content');
      if (viewer) {
        viewer.innerHTML = this._fileRenderedHtml;
      }
    }
  }

  private _renderTree(entries: FileEntry[], depth: number, fileSvg: unknown, folderSvg: unknown): unknown {
    if (entries.length === 0) return nothing;

    const sorted = [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map((entry) => {
      const indentClass = depth === 1 ? ' files-indent' : depth === 2 ? ' files-indent-2' : depth >= 3 ? ' files-indent-3' : '';
      const isSelected = this._selectedTreePath === entry.path;

      const icon = entry.kind === 'directory' ? folderSvg : fileSvg;
      const sizeStr = entry.size !== undefined ? formatFileSize(entry.size) : '';

      return html`
        <div class="files-tree-item${entry.kind === 'directory' ? ' directory' : ''}${indentClass}${isSelected ? ' selected' : ''}"
          @click=${entry.kind === 'file' ? () => this._loadFileContent(entry.path, entry.name) : nothing}>
          <span class="icon">${icon}</span>
          <span class="name">${escapeHtml(entry.name)}</span>
          ${sizeStr ? html`<span class="size">${sizeStr}</span>` : nothing}
        </div>
        ${entry.kind === 'directory' && entry.children ? this._renderTree(entry.children, depth + 1, fileSvg, folderSvg) : nothing}
      `;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-files-view': ChaosFilesView;
  }
}
