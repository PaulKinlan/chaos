/**
 * `<chaos-step-details>` -- Expandable agentic step indicator.
 *
 * Shows a collapsible `<details>` element with a step badge,
 * status text, and slotted content for the step body.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chaos-step-details')
export class ChaosStepDetails extends LitElement {
  createRenderRoot() { return this; }

  /** Step number (1-based). */
  @property({ type: Number }) step = 1;

  /** Total number of steps (0 = unknown). */
  @property({ type: Number, attribute: 'total-steps' }) totalSteps = 0;

  /** Status text displayed next to the step badge. */
  @property() status = 'working...';

  /** Whether the details element is open. */
  @property({ type: Boolean }) open = false;

  render() {
    const badge = this.totalSteps
      ? `Step ${this.step} of ${this.totalSteps}`
      : `Step ${this.step}`;

    return html`
      <details class="step-details" ?open=${this.open}>
        <summary class="step-summary">
          <span class="step-badge">${badge}</span>
          <span class="step-status">${this.status}</span>
        </summary>
        <div class="step-content">
          <slot></slot>
        </div>
      </details>
    `;
  }
}
