import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface FilterConfig {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value?: string;
}

/**
 * <chaos-filter-bar> — Reusable filter bar with dropdowns and optional search.
 *
 * Fires events: filter-change, search.
 * Uses Light DOM so existing CSS classes apply.
 */
@customElement('chaos-filter-bar')
export class ChaosFilterBar extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Array }) filters: FilterConfig[] = [];
  @property() searchPlaceholder?: string;
  @property() searchValue = '';

  render() {
    return html`
      <div class="filter-bar" style="display:flex;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-3);">
        ${this.filters.map(f => html`
          <select style="padding:4px 8px;font-size:var(--text-xs);background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);"
                  @change=${(e: Event) => this._onFilterChange(f.id, (e.target as HTMLSelectElement).value)}>
            ${f.options.map(o => html`<option value=${o.value} ?selected=${f.value === o.value}>${o.label}</option>`)}
          </select>
        `)}
        ${this.searchPlaceholder ? html`
          <chaos-search .placeholder=${this.searchPlaceholder} .value=${this.searchValue}
                        @search=${(e: CustomEvent) => this._onSearch(e.detail)}></chaos-search>
        ` : ''}
      </div>
    `;
  }

  private _onFilterChange(filterId: string, value: string) {
    this.dispatchEvent(new CustomEvent('filter-change', {
      detail: { filterId, value },
      bubbles: true,
    }));
  }

  private _onSearch(query: string) {
    this.searchValue = query;
    this.dispatchEvent(new CustomEvent('search', {
      detail: query,
      bubbles: true,
    }));
  }
}
