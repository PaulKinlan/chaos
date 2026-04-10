import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

/**
 * `<chaos-empty-state>` — placeholder for when a list or view has no content.
 *
 * Uses existing CSS classes: `.empty-state`, `.empty-state-icon`.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} heading - Title text
 * @property {string} description - Description text
 * @property {string} icon - SVG string for the icon (use ICON_REGISTRY values)
 *
 * @example
 * ```html
 * <chaos-empty-state
 *   heading="No artifacts yet"
 *   description="Artifacts created by agents will appear here."
 *   .icon=${ICON_REGISTRY['artifacts']}>
 * </chaos-empty-state>
 *
 * <chaos-empty-state heading="No results">
 *   <chaos-button variant="primary">Create one</chaos-button>
 * </chaos-empty-state>
 * ```
 */
@customElement('chaos-empty-state')
export class ChaosEmptyState extends LitElement {
  createRenderRoot() { return this; }

  @property() heading = '';
  @property() description = '';
  @property() icon?: string;

  render() {
    return html`<div class="empty-state">
      ${this.icon ? html`<div class="empty-state-icon">${unsafeHTML(this.icon)}</div>` : ''}
      ${this.heading ? html`<h3>${this.heading}</h3>` : ''}
      ${this.description ? html`<p>${this.description}</p>` : ''}
      <slot></slot>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-empty-state': ChaosEmptyState;
  }
}
