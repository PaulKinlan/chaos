/**
 * `<chaos-chat-input>` -- Chat text input area with send/stop button.
 *
 * Fires:
 *   - `send` (detail: string) when the user submits a message.
 *   - `stop` when the user clicks the stop button during streaming.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chaos-chat-input')
export class ChaosChatInput extends LitElement {
  createRenderRoot() { return this; }

  /** Disables the input and button. */
  @property({ type: Boolean }) disabled = false;

  /** When true, the send button becomes a stop button. */
  @property({ type: Boolean }) streaming = false;

  /** Placeholder text for the textarea. */
  @property() placeholder = 'Type a message...';

  /** Current input value. */
  @property() value = '';

  render() {
    const canSend = this.streaming || this.value.trim().length > 0;
    const btnTitle = this.streaming ? 'Stop' : 'Send';
    const iconName = this.streaming ? 'close' : 'send';

    return html`
      <div class="chat-input">
        <textarea
          .value=${this.value}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          @input=${this._onInput}
          @keydown=${this._onKeydown}
          rows="1"
        ></textarea>
        <button
          class="chat-btn-send"
          ?disabled=${this.disabled || !canSend}
          @click=${this._onSend}
          title=${btnTitle}
        >
          <chaos-icon name=${iconName} size="18"></chaos-icon>
        </button>
      </div>
    `;
  }

  private _onInput(e: Event) {
    this.value = (e.target as HTMLTextAreaElement).value;
  }

  private _onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._onSend();
    }
  }

  private _onSend() {
    if (this.streaming) {
      this.dispatchEvent(new CustomEvent('stop', { bubbles: true }));
    } else if (this.value.trim()) {
      this.dispatchEvent(new CustomEvent('send', {
        detail: this.value.trim(),
        bubbles: true,
      }));
      this.value = '';
    }
  }
}
