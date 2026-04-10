# CHAOS State Management

Global application state is managed with [Preact Signals](https://preactjs.com/guide/v10/signals/) (`@preact/signals-core`). Signals are reactive primitives that automatically notify subscribers when their value changes.

## Signals

Defined in `app-state.ts`:

| Signal | Type | Default | Purpose |
|--------|------|---------|---------|
| `activeView` | `Signal<string>` | `'chat'` | Currently active view name (e.g., `'chat'`, `'dashboard'`, `'tasks'`) |
| `activeAgentId` | `Signal<string \| null>` | `null` | ID of the currently selected agent |
| `agents` | `Signal<AgentMeta[]>` | `[]` | Full list of all agents |
| `focusedColumnId` | `Signal<string \| null>` | `null` | ID of the currently focused chat column |
| `debugMode` | `Signal<boolean>` | `false` | Whether debug mode is active |

## Computed Signals

Derived state that updates automatically when dependencies change:

| Computed | Type | Derivation |
|----------|------|------------|
| `activeAgent` | `Computed<AgentMeta \| null>` | Finds the agent in `agents` matching `activeAgentId` |
| `masterAgent` | `Computed<AgentMeta \| null>` | Finds the agent with `master: true` |
| `visibleAgents` | `Computed<AgentMeta[]>` | Filters `agents` to exclude those with `role === 'archived'` |

## SignalWatcher Mixin

The `SignalWatcher` mixin (in `signal-watcher.ts`) connects Lit components to signals. It:

1. Calls `watchSignals()` on `connectedCallback` to get the list of signals to watch
2. Creates an `effect()` for each signal that calls `requestUpdate()` when the signal changes
3. Disposes all effects on `disconnectedCallback` to prevent memory leaks

### Usage

```typescript
import { SignalWatcher } from '../../state/signal-watcher.js';
import { activeView, agents } from '../../state/app-state.js';

@customElement('my-component')
class MyComponent extends SignalWatcher(LitElement) {
  createRenderRoot() { return this; }

  // Declare which signals this component depends on
  protected watchSignals(): Signal<unknown>[] {
    return [activeView, agents];
  }

  render() {
    // Reading .value is safe here -- component re-renders when these change
    const view = activeView.value;
    const agentList = agents.value;
    return html`...`;
  }
}
```

### Current Usage

Currently, only `<chaos-sidebar>` uses `SignalWatcher` directly. Most view components receive their data as `@property()` values from `app.ts`, which reads the signals and passes data down.

## How to Add a New Signal

1. Define the signal in `app-state.ts`:

```typescript
export const myNewState = signal<MyType>(defaultValue);
```

2. If the signal is derived from others, use `computed`:

```typescript
export const derivedState = computed(() =>
  agents.value.filter(a => someCondition(a))
);
```

3. Export from `index.ts`.

4. In the component that needs it, either:
   - Use `SignalWatcher` mixin and read `.value` in `render()`
   - Or receive the data as a `@property()` from a parent that reads the signal

## How Components Subscribe to State Changes

There are two patterns in use:

### Pattern 1: Direct Signal Reading (via SignalWatcher)

The component watches signals directly. Used by `chaos-sidebar`.

```typescript
class MySidebar extends SignalWatcher(LitElement) {
  protected watchSignals() { return [activeView]; }
  render() { return html`Current view: ${activeView.value}`; }
}
```

### Pattern 2: Property Passing (via app.ts)

The parent (`app.ts`) reads signals, fetches data, and passes it as properties. Used by all view components.

```typescript
// In app.ts:
const view = document.createElement('chaos-tasks-view');
view.agents = agents.value;
view.activeAgentId = activeAgentId.value;

// In the component:
@property({ type: Array }) agents: AgentMeta[] = [];
```

Pattern 2 is preferred for views because it keeps data fetching centralized in `app.ts` and makes views easier to test in isolation.
