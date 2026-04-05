# Plan: Reactive UI with Preact Signals

## Status (audited 2026-04-04)

### Phase 1: Install and Wire Core State — TODO
- [ ] `@preact/signals-core` not in package.json dependencies
- [ ] No signal/computed/effect imports found anywhere in src/
- [ ] Core globals still mutable in app.ts (171 occurrences of innerHTML/classList.toggle/activeView/activeAgentId)

### Phase 2: DOM Binding Helpers — TODO
- [ ] No bindText/bindVisible/bindClass/bindList utilities found

### Phase 3: Migrate Sidebar — TODO
- [ ] Sidebar still uses imperative rendering

### Phase 4: Migrate View Panels — TODO
- [ ] View panels still use imperative DOM manipulation

### Phase 5: Migrate Chat Columns — TODO
- [ ] Chat columns still use innerHTML manipulation

### Phase 6: Remove Dead Code — TODO
- [ ] All legacy imperative code still in place

**Summary: This plan has not been started. The entire UI remains imperative with no reactive state layer.**

---

## Problem

The current UI uses imperative DOM manipulation (`innerHTML`, `classList.toggle`, manual element creation). State changes trigger full re-renders that lose user context: selected files reset, views jump, scroll positions lost. Every `onAgentListReceived`, hook trigger, or port reconnect risks blowing away the current view.

Root causes:
- No reactive state layer — UI reads from globals and re-renders everything
- `innerHTML =` destroys and recreates DOM subtrees, losing selection/scroll/focus
- View visibility managed by adding/removing CSS classes on every state change
- No diffing — even unchanged data causes full DOM replacement
- 13+ places call `sendPortMessage({ type: 'listAgents' })`, each triggering `onAgentListReceived` which re-renders the sidebar and can reset views

## Proposed Solution: Preact Signals

[Preact Signals](https://preactjs.com/guide/v10/signals/) provide fine-grained reactivity without a virtual DOM or framework. A signal holds a value; when it changes, only the DOM nodes that read it update. No diffing, no re-renders, no component tree.

**Why Signals over React/Preact components:**
- 1.5KB — minimal bundle impact
- Works with existing vanilla DOM code — no need to rewrite everything at once
- No JSX required (can use `signal.subscribe()` and manual DOM binding)
- Granular updates: changing `activeView` only updates the sidebar highlight and view panel visibility, not the entire page
- Can migrate incrementally — one state variable at a time

## Core State to Migrate

```typescript
// Current: mutable globals scattered throughout app.ts
let activeAgentId: string | null = null;
let activeView: string = 'chat';
let agents: AgentMeta[] = [];
let focusedColumnId: string | null = null;

// Proposed: signals
import { signal, computed, effect } from '@preact/signals-core';

const activeAgentId = signal<string | null>(null);
const activeView = signal<string>('chat');
const agents = signal<AgentMeta[]>([]);
const focusedColumnId = signal<string | null>(null);
const columns = signal<ChatColumn[]>([]);

// Derived state
const activeAgent = computed(() =>
  agents.value.find(a => a.id === activeAgentId.value)
);
const agentSubItems = computed(() =>
  agents.value.map(a => ({
    ...a,
    isActive: a.id === activeAgentId.value,
  }))
);
```

## Migration Phases

### Phase 1: Install and Wire Core State

1. `npm install @preact/signals-core` (no Preact needed, just the signals runtime)
2. Replace the 5 core globals with signals
3. Add `effect()` bindings for:
   - Sidebar view highlighting (`activeView` changes → update CSS classes)
   - View panel visibility (`activeView` changes → toggle `.active` on panels)
   - Sidebar agent list (`agents` or `activeAgentId` changes → re-render agent list)
   - URL hash sync (`activeView` or `activeAgentId` changes → update hash)

**Key principle:** effects run only when their dependencies change. Changing `agents` doesn't re-render the view panel. Changing `activeView` doesn't re-render the agent list.

### Phase 2: DOM Binding Helpers

Create a small utility for binding signals to DOM:

```typescript
// Bind a signal to a text node
function bindText(el: Element, sig: Signal<string>): void {
  effect(() => { el.textContent = sig.value; });
}

// Bind a signal to element visibility
function bindVisible(el: Element, sig: Signal<boolean>): void {
  effect(() => { (el as HTMLElement).style.display = sig.value ? '' : 'none'; });
}

// Bind a signal to a CSS class
function bindClass(el: Element, className: string, sig: Signal<boolean>): void {
  effect(() => { el.classList.toggle(className, sig.value); });
}

// Bind a signal to render a list (diff-based)
function bindList<T>(
  container: Element,
  items: Signal<T[]>,
  key: (item: T) => string,
  render: (item: T) => HTMLElement,
  update?: (el: HTMLElement, item: T) => void,
): void {
  effect(() => {
    const current = new Map<string, HTMLElement>();
    for (const child of container.children) {
      current.set((child as HTMLElement).dataset.key!, child as HTMLElement);
    }

    const newItems = items.value;
    const fragment = document.createDocumentFragment();

    for (const item of newItems) {
      const k = key(item);
      const existing = current.get(k);
      if (existing) {
        update?.(existing, item);
        fragment.appendChild(existing);
        current.delete(k);
      } else {
        const el = render(item);
        el.dataset.key = k;
        fragment.appendChild(el);
      }
    }

    // Remove items no longer in the list
    for (const el of current.values()) el.remove();

    container.appendChild(fragment);
  });
}
```

### Phase 3: Migrate Sidebar

Replace `renderAgentTabs()` with `bindList()`:

```typescript
const sidebarAgentList = document.getElementById('sidebar-agent-list')!;

bindList(
  sidebarAgentList,
  agentSubItems,
  (a) => a.id,
  (a) => createAgentSidebarItem(a),
  (el, a) => updateAgentSidebarItem(el, a),
);
```

This means:
- Adding an agent → one new DOM element appended
- Removing an agent → one DOM element removed
- Changing active agent → only the `.active` class toggles on two elements
- No full innerHTML replacement

### Phase 4: Migrate View Panels

Each view becomes an effect that only fires when its signal dependencies change:

```typescript
// Memory view: only re-renders when activeAgentId changes AND view is 'files'
effect(() => {
  if (activeView.value !== 'files') return;
  const agentId = activeAgentId.value;
  if (!agentId) return;
  // Load files only if agent changed
  loadFilesView(agentId);
});

// Tasks view: only re-renders when tasks data changes
const tasksData = signal<Task[]>([]);
effect(() => {
  if (activeView.value !== 'tasks') return;
  renderTasksList(tasksData.value);
});
```

### Phase 5: Migrate Chat Columns

Chat columns are the most complex. Each column becomes a signal-driven component:

```typescript
interface ColumnState {
  id: string;
  agentId: string;
  isStreaming: Signal<boolean>;
  messages: Signal<HTMLElement[]>;  // DOM elements, not data
  headerName: Signal<string>;
}
```

Streaming updates append to the messages array signal rather than innerHTML manipulation.

### Phase 6: Remove Dead Code

Once all views are signal-driven:
- Remove `onAgentListReceived` cascade
- Remove `updateViewVisibility()` (effects handle it)
- Remove `loadCurrentViewData()` (effects handle it)
- Remove manual `classList.toggle` calls for view switching
- Remove the 13 `sendPortMessage({ type: 'listAgents' })` calls that trigger full re-renders (signals react to data changes, not message events)

## What NOT to Change

- The port-based communication model (background ↔ UI) stays
- The one-shot message model (sendMsg) stays
- Chat column DOM structure stays (just backed by signals instead of manual manipulation)
- CSS stays as-is
- No JSX, no component framework, no build tool changes

## Risks

1. **Signal cleanup**: Effects must be disposed when their DOM is removed, or they leak. Need `dispose()` calls in column close handlers.
2. **Bulk updates**: Multiple signal changes in one handler fire multiple effects. Use `batch()` to group them.
3. **Migration conflicts**: During incremental migration, some code reads globals while other code reads signals. Need a transition period where signals write-through to globals.

## Estimated Scope

- Phase 1-2: ~2 hours (install, core state, helpers)
- Phase 3: ~1 hour (sidebar)
- Phase 4: ~2 hours (view panels)
- Phase 5: ~3 hours (chat columns — most complex)
- Phase 6: ~1 hour (cleanup)

Total: ~9 hours of focused work, but can be done incrementally across sessions.

## Alternative: Lit HTML

If signals feel too low-level, [Lit](https://lit.dev/) provides tagged template literals with efficient re-rendering:

```typescript
import { html, render } from 'lit-html';

function renderAgentList(agents: AgentMeta[], activeId: string) {
  return html`${agents.map(a => html`
    <details class="sidebar-agent-details" open>
      <summary class="sidebar-agent-item ${a.id === activeId ? 'active' : ''}"
               @click=${() => switchToAgent(a.id)}>
        ${a.name}
      </summary>
      <div class="sidebar-agent-sub">...</div>
    </details>
  `)}`;
}

// Only the changed parts of the template re-render
effect(() => {
  render(renderAgentList(agents.value, activeAgentId.value), sidebarAgentList);
});
```

Lit HTML is 4KB and handles the diffing automatically. Could combine with signals for state management.

## Recommendation

Start with **Preact Signals + manual DOM binding** (Phases 1-3). This fixes the immediate pain (view resets, state loss) with minimal risk. Evaluate whether to adopt Lit HTML for more complex views (Phase 4-5) after seeing how the manual approach feels.
