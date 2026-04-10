import { effect, type Signal } from '@preact/signals-core';
import type { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Mixin that watches specific signals and requests update when they change.
 * Uses microtask batching so multiple signal changes in the same tick
 * only trigger ONE re-render.
 *
 * Usage:
 *   class MyEl extends SignalWatcher(LitElement) {
 *     protected watchSignals() { return [activeView, agents]; }
 *   }
 */
export function SignalWatcher<T extends Constructor<LitElement>>(Base: T) {
  return class extends Base {
    private __disposers: Array<() => void> = [];
    private __updatePending = false;

    /** Override to return signals this component should watch */
    protected watchSignals(): Signal<unknown>[] { return []; }

    private __scheduleUpdate() {
      if (this.__updatePending) return;
      this.__updatePending = true;
      // Batch: wait for microtask so multiple signal changes
      // in the same tick only cause ONE re-render
      queueMicrotask(() => {
        this.__updatePending = false;
        this.requestUpdate();
      });
    }

    override connectedCallback() {
      super.connectedCallback();
      // Skip the initial effect trigger — the component will render
      // naturally via connectedCallback → firstUpdated
      let initialized = false;
      queueMicrotask(() => { initialized = true; });

      for (const sig of this.watchSignals()) {
        const dispose = effect(() => {
          sig.value; // Subscribe to this signal
          if (initialized) {
            this.__scheduleUpdate();
          }
        });
        this.__disposers.push(dispose);
      }
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      for (const d of this.__disposers) d();
      this.__disposers = [];
      this.__updatePending = false;
    }
  } as unknown as T;
}
