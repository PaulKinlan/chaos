/**
 * `<chaos-artifact-detail>` — Reusable artifact detail viewer.
 *
 * Shows an artifact's content in a modal with secure viewer, pin/unpin,
 * download, and metadata. Can be used from any view — dashboard, artifacts,
 * chat, or anywhere an artifact needs to be previewed.
 *
 * Usage:
 *   <chaos-artifact-detail></chaos-artifact-detail>
 *   // Then call: element.show(artifact)
 */

import { LitElement, html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';
import { createSecureViewer, detectContentType } from '../../ui/secure-viewer.js';
import type { SecureViewer } from '../../ui/secure-viewer.js';
import type { ArtifactMeta } from '../../storage/types.js';

@customElement('chaos-artifact-detail')
export class ChaosArtifactDetail extends LitElement {
  createRenderRoot() { return this; }

  @state() private _open = false;
  @state() private _artifact: ArtifactMeta | null = null;
  @state() private _content = '';
  @state() private _loading = false;

  private _viewer: SecureViewer | null = null;

  /** Show the detail modal for an artifact. Call from any view. */
  async show(artifact: ArtifactMeta): Promise<void> {
    this._artifact = artifact;
    this._loading = true;
    this._open = true;

    // Read the content
    let fileContent = '';
    try {
      const result = await sendMsg<{ content: string }>({
        type: 'readArtifactContent',
        path: artifact.path,
      });
      if (result?.content) {
        fileContent = result.content;
      } else {
        // Fallback: try agent-scoped path
        try {
          const agentResult = await sendMsg<{ content: string }>({
            type: 'readArtifactContent',
            path: `agents/${artifact.agentId}/${artifact.path}`,
          });
          if (agentResult?.content) fileContent = agentResult.content;
        } catch { /* fallback failed */ }
      }
    } catch {
      fileContent = '(Unable to read file content)';
    }

    this._content = fileContent;
    this._loading = false;

    // Wait for render, then create the secure viewer
    await this.updateComplete;
    this._createViewer();
  }

  /** Close the modal */
  close(): void {
    this._open = false;
    this._artifact = null;
    if (this._viewer) {
      this._viewer.destroy();
      this._viewer = null;
    }
  }

  private _createViewer(): void {
    if (this._viewer) {
      this._viewer.destroy();
      this._viewer = null;
    }

    const container = this.querySelector('#artifact-detail-viewer') as HTMLElement;
    if (!container || !this._artifact) return;

    const artifact = this._artifact;
    const contentType = artifact.type && artifact.type !== 'webpage' && artifact.type !== 'image'
      ? artifact.type as 'html' | 'markdown' | 'text' | 'json' | 'csv'
      : artifact.type === 'webpage' ? 'html' : detectContentType(artifact.path);

    const filename = artifact.path.split('/').pop() || artifact.path;
    const displayTitle = artifact.title || filename;

    this._viewer = createSecureViewer(container, this._content, {
      type: contentType,
      title: displayTitle,
      downloadFilename: filename,
    });
  }

  private async _togglePin(): Promise<void> {
    if (!this._artifact) return;
    const newPinned = !this._artifact.pinned;
    await sendMsg({
      type: 'updateArtifactMeta',
      artifactPath: this._artifact.path,
      updates: { pinned: newPinned },
    });
    this._artifact = { ...this._artifact, pinned: newPinned };
    this.dispatchEvent(new CustomEvent('artifact-updated', { bubbles: true, composed: true }));
  }

  private _openInNewTab(): void {
    if (!this._content) return;
    const type = this._artifact?.type || 'text';
    const isHtml = type === 'html' || type === 'webpage' || this._content.trim().startsWith('<!') || this._content.trim().startsWith('<html');
    const mimeType = isHtml ? 'text/html' : type === 'markdown' ? 'text/markdown' : 'text/plain';
    const blob = new Blob([this._content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Clean up after a delay (the new tab needs time to load)
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  private async _toggleFullscreen(): Promise<void> {
    const dialog = this.querySelector('#chaos-artifact-dialog') as HTMLDialogElement;
    if (!dialog) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      dialog.style.maxWidth = '700px';
      dialog.style.width = '90vw';
      dialog.style.maxHeight = '85vh';
      dialog.style.borderRadius = '12px';
    } else {
      dialog.style.maxWidth = '100vw';
      dialog.style.width = '100vw';
      dialog.style.maxHeight = '100vh';
      dialog.style.borderRadius = '0';
      await dialog.requestFullscreen().catch(() => {
        // Fullscreen API may not be available — just use max size
      });
    }
  }

  private _download(): void {
    if (!this._content) return;
    const filename = this._artifact?.path.split('/').pop() || 'artifact.txt';
    const blob = new Blob([this._content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  render() {
    if (!this._open || !this._artifact) return nothing;

    const artifact = this._artifact;
    const displayName = artifact.title || artifact.path.split('/').pop() || artifact.path;
    const pinIcon = artifact.pinned
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z"/></svg>';

    return html`
      <dialog id="chaos-artifact-dialog" style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-default);border-radius:12px;padding:0;max-width:700px;width:90vw;max-height:85vh;overflow:hidden;position:fixed;inset:0;margin:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border-subtle);">
          <h3 style="margin:0;font-size:var(--text-base);">${this._escapeHtml(displayName)}</h3>
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <button class="btn btn-ghost btn-xs" @click=${this._togglePin} title="${artifact.pinned ? 'Unpin' : 'Pin'}" style="color:${artifact.pinned ? 'var(--accent)' : 'var(--text-muted)'};">
              ${unsafeHTML(pinIcon)}
            </button>
            <button class="btn btn-ghost btn-xs" @click=${this._openInNewTab} title="Open in new tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="btn btn-ghost btn-xs" @click=${this._toggleFullscreen} title="Fullscreen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button class="btn btn-ghost btn-xs" @click=${this._download} title="Download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="btn btn-ghost btn-xs" @click=${this.close} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div style="padding:20px;overflow-y:auto;max-height:calc(85vh - 60px);">
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-3);">
            ${this._escapeHtml(artifact.description)} &middot; <code style="font-size:10px;">${this._escapeHtml(artifact.path)}</code>
          </div>
          ${this._loading
            ? html`<div style="text-align:center;padding:var(--sp-6);"><div class="spinner"></div></div>`
            : html`<div class="secure-viewer-container" id="artifact-detail-viewer" style="height:400px;"></div>`
          }
        </div>
      </dialog>
    `;
  }

  updated() {
    const dialog = this.querySelector('#chaos-artifact-dialog') as HTMLDialogElement;
    if (dialog && this._open && !dialog.open) {
      dialog.showModal();
    }
    if (dialog && !this._open && dialog.open) {
      dialog.close();
    }
  }
}
