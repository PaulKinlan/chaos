/**
 * `<chaos-chat-view>` -- Multi-column chat container.
 *
 * A thin wrapper that provides the columns layout shell and the
 * "add column" picker area.  The actual chat columns, streaming,
 * and message management remain in app.ts for now -- this component
 * just owns the structural markup.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chaos-chat-view')
export class ChaosChatView extends LitElement {
  createRenderRoot() { return this; }

  /** Whether the multi-column layout is active. */
  @property({ type: Boolean, attribute: 'multi-column' }) multiColumn = false;

  render() {
    return html`
      <div class="columns-container${this.multiColumn ? ' multi-column' : ''}" id="columns-container">
        <slot></slot>
      </div>
      <div class="column-add-picker" id="column-add-picker">
        <slot name="add-picker"></slot>
      </div>
    `;
  }
}
