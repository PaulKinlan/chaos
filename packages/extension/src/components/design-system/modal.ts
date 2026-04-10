import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './icon.js';

/**
 * `<chaos-modal>` — a modal dialog wrapping the native `<dialog>` element.
 *
 * Uses CSS variables from the design system for theming.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {boolean} open - Controls visibility. Setting to true calls showModal(), false calls close().
 * @property {string} heading - Modal title displayed in the header bar.
 *
 * @fires close - When the close button is clicked or the dialog is dismissed.
 *
 * @example
 * ```html
 * <chaos-modal heading="Confirm Delete" .open=${showDialog}>
 *   <p>Are you sure you want to delete this item?</p>
 *   <chaos-button variant="danger" @click=${doDelete}>Delete</chaos-button>
 * </chaos-modal>
 * ```
 */
@customElement('chaos-modal')
export class ChaosModal extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Boolean }) open = false;
  @property() heading = '';

  updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      const dialog = this.querySelector('dialog');
      if (this.open) {
        dialog?.showModal();
      } else {
        dialog?.close();
      }
    }
  }

  private _onClose() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true }));
  }

  render() {
    return html`<dialog
      style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-default);border-radius:12px;padding:0;max-width:600px;width:90vw;position:fixed;inset:0;margin:auto;"
      @close=${this._onClose}>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border-subtle);">
        <h3 style="margin:0;">${this.heading}</h3>
        <button class="btn btn-ghost" @click=${this._onClose} style="padding:4px;">
          <chaos-icon name="close" size="18"></chaos-icon>
        </button>
      </div>
      <div style="padding:20px;overflow-y:auto;max-height:70vh;">
        <slot></slot>
      </div>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-modal': ChaosModal;
  }
}
