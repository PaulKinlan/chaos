/**
 * `<chaos-chat-message>` -- Renders a single chat message bubble.
 *
 * Wraps its slotted content in the appropriate CSS class based on
 * the message role and streaming state.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chaos-chat-message')
export class ChaosChatMessage extends LitElement {
  createRenderRoot() { return this; }

  /** Message role -- controls the CSS class applied. */
  @property() role: 'user' | 'assistant' | 'system' | 'error' | 'tool-call' = 'user';

  /** Whether this message is currently being streamed. */
  @property({ type: Boolean }) streaming = false;

  render() {
    const classes = [
      'chat-message',
      this.role === 'user' ? 'user' : '',
      this.role === 'assistant' ? 'assistant' : '',
      this.role === 'system' ? 'system' : '',
      this.role === 'error' ? 'error' : '',
      this.role === 'tool-call' ? 'tool-call' : '',
      this.streaming ? 'thinking-stream active' : '',
    ].filter(Boolean).join(' ');

    return html`<div class=${classes}><slot></slot></div>`;
  }
}
