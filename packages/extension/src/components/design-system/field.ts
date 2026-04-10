import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<chaos-field>` — a label + input wrapper for form fields.
 *
 * Uses existing CSS class: `.settings-field`.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} label - Field label text
 * @property {string} hint - Optional hint text below the label
 * @property {string} error - Optional error message below the input
 *
 * @example
 * ```html
 * <chaos-field label="API Key" hint="Get one from anthropic.com">
 *   <input type="text" .value=${key}>
 * </chaos-field>
 *
 * <chaos-field label="Name" error="Name is required">
 *   <input type="text">
 * </chaos-field>
 * ```
 */
@customElement('chaos-field')
export class ChaosField extends LitElement {
  createRenderRoot() { return this; }

  @property() label = '';
  @property() hint?: string;
  @property() error?: string;

  render() {
    return html`<div class="settings-field">
      ${this.label ? html`<label>${this.label}</label>` : ''}
      ${this.hint ? html`<p style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:var(--sp-2);">${this.hint}</p>` : ''}
      <slot></slot>
      ${this.error ? html`<p style="font-size:var(--text-xs);color:var(--danger-text);margin-top:var(--sp-1);">${this.error}</p>` : ''}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-field': ChaosField;
  }
}
