import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<chaos-search>` — a search/filter input field.
 *
 * Dispatches a `search` CustomEvent on every keystroke with the current value.
 * Uses `.settings-field input` styles from the existing CSS.
 * Renders into Light DOM so parent styles apply.
 *
 * @property {string} placeholder - Placeholder text
 * @property {string} value - Current input value
 *
 * @fires search - On every input, with `detail` set to the current value string.
 *
 * @example
 * ```html
 * <chaos-search placeholder="Filter tasks..." @search=${onFilter}></chaos-search>
 * ```
 */
@customElement('chaos-search')
export class ChaosSearch extends LitElement {
  createRenderRoot() { return this; }

  @property() placeholder = 'Search...';
  @property() value = '';

  private _onInput(e: Event) {
    this.value = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent('search', { detail: this.value, bubbles: true }));
  }

  render() {
    return html`<input
      type="text"
      .value=${this.value}
      .placeholder=${this.placeholder}
      @input=${this._onInput}
      style="width:100%;padding:var(--sp-2) var(--sp-3);background:var(--bg-raised);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:var(--text-sm);outline:none;"
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-search': ChaosSearch;
  }
}
