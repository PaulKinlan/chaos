import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<chaos-card>` — a container for settings panels and dashboard sections.
 *
 * Uses existing CSS class: `.settings-card`.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} heading - Optional heading text rendered as <h3>
 * @property {boolean} interactive - Adds pointer cursor for clickable cards
 *
 * @example
 * ```html
 * <chaos-card heading="API Keys">
 *   <p>Configure your API keys here.</p>
 * </chaos-card>
 *
 * <chaos-card heading="Agent" interactive @click=${selectAgent}>
 *   <p>Click to configure</p>
 * </chaos-card>
 * ```
 */
@customElement('chaos-card')
export class ChaosCard extends LitElement {
  createRenderRoot() { return this; }

  @property() heading?: string;
  @property({ type: Boolean }) interactive = false;

  render() {
    return html`<div class="settings-card" style=${this.interactive ? 'cursor:pointer;' : ''}>
      ${this.heading ? html`<h3>${this.heading}</h3>` : ''}
      <slot></slot>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-card': ChaosCard;
  }
}
