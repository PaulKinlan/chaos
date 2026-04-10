import { effect, type Signal } from '@preact/signals-core';
import type { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Mixin that watches specific signals and requests update when they change.
 *
 * Usage:
 *   class MyEl extends SignalWatcher(LitElement) {
 *     protected watchSignals() { return [activeView, agents]; }
 *   }
 */
export function SignalWatcher<T extends Constructor<LitElement>>(Base: T) {
  return class extends Base {
    private __disposers: Array<() => void> = [];

    /** Override to return signals this component should watch */
    protected watchSignals(): Signal<unknown>[] { return []; }

    override connectedCallback() {
      super.connectedCallback();
      for (const sig of this.watchSignals()) {
        const dispose = effect(() => {
          sig.value; // Subscribe to this signal
          this.requestUpdate();
        });
        this.__disposers.push(dispose);
      }
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      for (const d of this.__disposers) d();
      this.__disposers = [];
    }
  } as unknown as T;
}
