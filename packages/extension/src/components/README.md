# CHAOS Component Architecture

The CHAOS UI is built with [Lit](https://lit.dev/) Web Components organized into three layers: a **design system** of primitives, **shared** components used across views, and **view** components that each own a full screen of the application.

## Directory Structure

```
components/
  design-system/       Primitive UI components (badge, button, card, field, etc.)
    tokens.ts          Design token constants referencing CSS custom properties
    index.ts           Barrel export — registers all design-system elements
    README.md          Design system documentation
  shared/              Complex components used across multiple views
    index.ts           Barrel export — registers all shared elements
    README.md          Shared component documentation
  views/               Screen-level components, one per application view
    index.ts           Barrel export — registers all view elements
    README.md          View component documentation
```

## How to Create a New Component

1. **Create the file** in the appropriate directory (`design-system/`, `shared/`, or `views/`).

2. **Extend `LitElement`** and use Light DOM rendering:

```typescript
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('chaos-my-component')
export class ChaosMyComponent extends LitElement {
  // Light DOM — required so existing CSS variables and classes apply
  createRenderRoot() { return this; }

  // Public API — data passed in from parent
  @property() label = '';
  @property({ type: Boolean }) active = false;

  // Internal state — not visible to parent
  @state() private _loading = false;

  render() {
    return html`<div class="my-class">${this.label}</div>`;
  }
}
```

3. **Export from the barrel** (`index.ts`) in the same directory.

4. **Register the tag name** in the global `HTMLElementTagNameMap`:

```typescript
declare global {
  interface HTMLElementTagNameMap {
    'chaos-my-component': ChaosMyComponent;
  }
}
```

## Conventions

### Light DOM Requirement

Every component uses `createRenderRoot() { return this; }` to render into the Light DOM. This is critical because:

- All styling comes from CSS variables and classes defined in `app.html`
- Shadow DOM would isolate components from the existing stylesheet
- Parent components can style children without piercing shadow boundaries

### Naming

- All custom elements are prefixed with `chaos-` (Web Component naming rules require a hyphen)
- View components use the `-view` suffix: `chaos-usage-view`, `chaos-tasks-view`
- File names match the component name in kebab-case: `usage-view.ts`, `filter-bar.ts`

### Properties vs State

- `@property()` — data passed in from parent components or attributes. Part of the public API.
- `@state()` — internal component state. Private, prefixed with underscore (`_loading`, `_data`).

### Event Naming

Components communicate upward via `CustomEvent`:

```typescript
this.dispatchEvent(new CustomEvent('view-change', {
  detail: { view: 'chat', prompt: '...' },
  bubbles: true,
  composed: true,
}));
```

- Use kebab-case event names: `view-change`, `filter-change`, `agent-change`, `create-agent`
- Always set `bubbles: true` so events propagate up the DOM tree
- Set `composed: true` when the event needs to cross shadow boundaries (future-proofing)
- Put payload data in the `detail` property

### Templates

- All rendering uses Lit `html` tagged templates -- never `innerHTML` or raw HTML strings
- Use `nothing` (from `lit`) instead of empty strings for conditional rendering
- Use `unsafeHTML` only for trusted SVG icon strings from `ICON_REGISTRY`

## State Flow: Signals to Components

Global application state lives in `state/app-state.ts` as Preact signals:

```
Signals (app-state.ts)
    |
    v
SignalWatcher mixin (signal-watcher.ts)
    |
    v
Components (re-render on signal change)
```

1. **Signals** are reactive primitives. Reading `.value` subscribes the reader to changes.
2. **SignalWatcher** is a mixin that watches specific signals and calls `requestUpdate()` when they change.
3. **Components** extend `SignalWatcher(LitElement)` and override `watchSignals()` to declare dependencies.

```typescript
class MyView extends SignalWatcher(LitElement) {
  protected watchSignals() { return [activeView, agents]; }

  render() {
    const view = activeView.value;  // auto-subscribed
    // ...
  }
}
```

Most view components receive data via `@property()` from `app.ts` rather than reading signals directly. Only the sidebar currently uses `SignalWatcher`.

## Messaging: How Components Talk to the Background

Components use the `sendMsg` and `sendPortMessage` singletons from `services/messaging.ts`:

```typescript
import { sendMsg, sendPortMessage } from '../../services/messaging.js';

// Request-response (via chrome.runtime.sendMessage)
const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });

// Fire-and-forget (via chrome.runtime port)
sendPortMessage({ type: 'agenticChat', agentId, message });
```

- `sendMsg` — async request/response for data fetching (getArtifacts, getMessages, etc.)
- `sendPortMessage` — fire-and-forget for streaming operations (agenticChat, getHooks, etc.)
- Both are initialized by `app.ts` at startup via `setSendMsg()` / `setSendPortMessage()`

## How to Add a New View

1. Create `views/my-view.ts` extending `LitElement` with Light DOM rendering
2. Add a `refresh()` method that fetches data via `sendMsg`
3. Export from `views/index.ts`
4. In `app.ts`, add a case to the view-switching logic that creates/shows your component
5. Add a sidebar entry in `shared/sidebar.ts` (add to `_renderNavItem` calls)
6. Add an icon to `ICON_REGISTRY` in `design-system/icon.ts` if needed

## Design System Usage

Import primitives from the design system:

```typescript
import '../design-system/index.js'; // registers all elements

// Then use in templates:
html`
  <chaos-card heading="My Section">
    <chaos-field label="Name" hint="Enter your name">
      <input type="text" .value=${name}>
    </chaos-field>
    <chaos-badge variant="green">Active</chaos-badge>
    <chaos-button variant="primary" @click=${save}>Save</chaos-button>
  </chaos-card>
`;
```

See [design-system/README.md](design-system/README.md) for the full component catalog.
