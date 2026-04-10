import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<chaos-button>` — a styled button with variant and size support.
 *
 * Uses existing CSS classes: `.btn`, `.btn-{variant}`, `.btn-{size}`.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} variant - 'primary' | 'danger' | 'ghost'
 * @property {string} size - 'xs' | 'sm' | 'md'
 * @property {boolean} disabled - Disables the button
 * @property {boolean} loading - Shows a spinner and disables the button
 *
 * @example
 * ```html
 * <chaos-button variant="primary" @click=${save}>Save</chaos-button>
 * <chaos-button variant="danger" size="sm">Delete</chaos-button>
 * <chaos-button loading>Saving...</chaos-button>
 * ```
 */
@customElement('chaos-button')
export class ChaosButton extends LitElement {
  createRenderRoot() { return this; }

  @property() variant: 'primary' | 'danger' | 'ghost' = 'ghost';
  @property() size: 'xs' | 'sm' | 'md' = 'md';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) loading = false;

  render() {
    const classes = `btn btn-${this.variant}${this.size !== 'md' ? ` btn-${this.size}` : ''}`;
    return html`<button class=${classes} ?disabled=${this.disabled || this.loading}>
      ${this.loading ? html`<span class="spinner" style="width:14px;height:14px;"></span>` : ''}
      <slot></slot>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-button': ChaosButton;
  }
}
