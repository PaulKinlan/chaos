import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<chaos-badge>` — a small status/category label.
 *
 * Uses existing CSS classes: `.badge`, `.badge-{variant}`.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} variant - Visual style: 'info' | 'active' | 'blue' | 'purple' | 'amber' | 'green' | 'red' | 'gray'
 *
 * @example
 * ```html
 * <chaos-badge variant="green">Enabled</chaos-badge>
 * <chaos-badge variant="red">Error</chaos-badge>
 * <chaos-badge variant="info">3 new</chaos-badge>
 * ```
 */
@customElement('chaos-badge')
export class ChaosBadge extends LitElement {
  createRenderRoot() { return this; }

  @property() variant: 'info' | 'active' | 'blue' | 'purple' | 'amber' | 'green' | 'red' | 'gray' = 'gray';

  render() {
    return html`<span class="badge badge-${this.variant}"><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-badge': ChaosBadge;
  }
}
