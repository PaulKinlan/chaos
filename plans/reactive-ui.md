# Plan: Lit HTML Component Architecture & Design System

## Status

- Phase 1: DONE (design system primitives)
- Phase 2: DONE (shared components + state signals)
- Phases 3-8: TODO.

---

## Problem

The current UI is a single 8,000-line app.ts file using imperative DOM manipulation (`innerHTML`, `classList.toggle`, manual element creation). This causes:

1. **No reuse** — the same patterns (settings cards, badges, empty states, filter bars) are copy-pasted 30+ times
2. **Hard to update** — changing a badge style means finding all 50+ inline badge definitions
3. **State loss** — `innerHTML =` destroys and recreates DOM subtrees, losing scroll/selection/focus
4. **No isolation** — everything is in one file, every change risks breaking something else
5. **No documentation** — new contributors have to read 8,000 lines to understand the UI
6. **No design system** — colors, spacing, typography are ad-hoc CSS variables with no component abstraction

## Solution: Lit HTML Components + Design System

[Lit](https://lit.dev/) provides:
- Web Components with reactive properties
- Template literals with efficient diffing (`html\`...\``)
- Scoped styles (Shadow DOM optional, can use Light DOM)
- TypeScript-native
- 5KB runtime — minimal bundle impact
- Works alongside existing code — incremental migration

### Architecture

```
packages/extension/src/
  components/             ← NEW: reusable Lit components
    design-system/        ← Primitives (badge, button, card, field, empty-state)
    views/                ← Screen-level components (one per view)
    shared/               ← Shared complex components (modal, search, secure-viewer)
  app.ts                  ← Shrinks: just routing, port handling, SDK glue
  app.html                ← Shrinks: just shell + script tag
```

## Design System

### Design Tokens

Extract CSS variables into a documented token file:

```typescript
// components/design-system/tokens.ts
export const tokens = {
  // Colors
  bgBase: 'var(--bg-base)',
  bgSurface: 'var(--bg-surface)',
  bgRaised: 'var(--bg-raised)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  danger: 'var(--danger)',

  // Spacing
  sp1: 'var(--sp-1)',  // 4px
  sp2: 'var(--sp-2)',  // 8px
  sp3: 'var(--sp-3)',  // 12px
  sp4: 'var(--sp-4)',  // 16px

  // Typography
  textXs: 'var(--text-xs)',   // 0.6875rem
  textSm: 'var(--text-sm)',   // 0.8125rem
  textBase: 'var(--text-base)', // 0.875rem

  // Borders
  borderSubtle: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  radiusSm: '6px',
  radiusMd: '8px',
};
```

### Primitive Components

#### `<chaos-badge>`
```typescript
@customElement('chaos-badge')
class ChaosBadge extends LitElement {
  @property() variant: 'info' | 'active' | 'blue' | 'purple' | 'amber' | 'green' | 'red' | 'gray' = 'gray';
  @property() size: 'sm' | 'md' = 'md';
}
// Usage: <chaos-badge variant="active">Enabled</chaos-badge>
```

#### `<chaos-button>`
```typescript
@customElement('chaos-button')
class ChaosButton extends LitElement {
  @property() variant: 'primary' | 'danger' | 'ghost' = 'ghost';
  @property() size: 'xs' | 'sm' | 'md' = 'md';
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) loading = false;
}
// Usage: <chaos-button variant="primary" @click=${save}>Save</chaos-button>
```

#### `<chaos-card>`
```typescript
@customElement('chaos-card')
class ChaosCard extends LitElement {
  @property() heading?: string;
  @property({ type: Boolean }) interactive = false; // hover + cursor
}
// Usage: <chaos-card heading="API Keys"><slot></slot></chaos-card>
```

#### `<chaos-field>`
```typescript
@customElement('chaos-field')
class ChaosField extends LitElement {
  @property() label = '';
  @property() hint?: string;
  @property() error?: string;
}
// Usage: <chaos-field label="API Key" hint="Get one from anthropic.com"><input .value=${key}></chaos-field>
```

#### `<chaos-empty-state>`
```typescript
@customElement('chaos-empty-state')
class ChaosEmptyState extends LitElement {
  @property() icon?: string; // SVG string
  @property() heading = '';
  @property() description = '';
}
```

#### `<chaos-modal>`
```typescript
@customElement('chaos-modal')
class ChaosModal extends LitElement {
  @property({ type: Boolean }) open = false;
  @property() heading = '';
  // Uses native <dialog> internally
}
```

#### `<chaos-search>`
```typescript
@customElement('chaos-search')
class ChaosSearch extends LitElement {
  @property() placeholder = 'Search...';
  @property() value = '';
  // Fires 'search' event on input
}
```

#### `<chaos-icon>`
```typescript
@customElement('chaos-icon')
class ChaosIcon extends LitElement {
  @property() name: string = ''; // key into icon registry
  @property() size: number = 16;
}
```

### Shared Components

#### `<chaos-secure-viewer>`
Wraps the existing `createSecureViewer()` as a Lit component:
```typescript
@customElement('chaos-secure-viewer')
class ChaosSecureViewer extends LitElement {
  @property() content = '';
  @property() type: 'html' | 'markdown' | 'text' | 'json' | 'csv' = 'text';
  @property() title = '';
}
```

#### `<chaos-filter-bar>`
```typescript
@customElement('chaos-filter-bar')
class ChaosFilterBar extends LitElement {
  @property({ type: Array }) filters: Array<{ id: string; label: string; options: string[] }> = [];
  @property() searchPlaceholder?: string;
  // Fires 'filter-change' event
}
```

### View Components

Each screen becomes its own component file:

| Component | File | Replaces | Lines saved |
|-----------|------|----------|-------------|
| `<chaos-dashboard>` | views/dashboard.ts | loadDashboard + renderDashboard | ~380 |
| `<chaos-chat-view>` | views/chat.ts | chat column management | ~500 |
| `<chaos-tasks-view>` | views/tasks.ts | renderTasks + renderTaskTimeline | ~330 |
| `<chaos-artifacts-view>` | views/artifacts.ts | renderArtifacts + showArtifactDetail | ~400 |
| `<chaos-channels-view>` | views/channels.ts | renderChannelsUI + renderChannelsList | ~450 |
| `<chaos-hooks-view>` | views/hooks.ts | renderHooksList + renderHookPresets | ~540 |
| `<chaos-usage-view>` | views/usage.ts | loadUsageView | ~200 |
| `<chaos-files-view>` | views/files.ts | loadFilesView + renderFileTree | ~150 |
| `<chaos-messages-view>` | views/messages.ts | renderMessages | ~120 |
| `<chaos-agent-settings>` | views/agent-settings.ts | loadAgentSettings | ~710 |
| `<chaos-global-settings>` | views/global-settings.ts | loadSettings + loadPermissions | ~530 |

### State Management

Use Lit's `@state()` for local component state and a shared context for global state:

```typescript
// state/app-state.ts
import { signal } from '@lit-labs/signals'; // or @preact/signals-core

export const appState = {
  activeView: signal<string>('chat'),
  activeAgentId: signal<string | null>(null),
  agents: signal<AgentMeta[]>([]),
  focusedColumnId: signal<string | null>(null),
};
```

Components subscribe to signals they need:

```typescript
@customElement('chaos-sidebar')
class ChaosSidebar extends SignalWatcher(LitElement) {
  render() {
    const view = appState.activeView.value;
    const agents = appState.agents.value;
    return html`...`;
  }
}
```

## Implementation Phases

### Phase 1: Setup + Design System Primitives

1. Install Lit: `npm install lit`
2. Create `components/design-system/` directory
3. Implement primitive components: badge, button, card, field, empty-state, icon, modal, search
4. Create `components/design-system/tokens.ts` with documented design tokens
5. Create `components/design-system/README.md` documenting each component with examples
6. Write Storybook-style demo page for all primitives (or a simple HTML page)
7. **Test**: verify primitives render in the extension context (Light DOM, CSS var inheritance)
8. **Deliverable**: importable component library, documented, working in extension

### Phase 2: Shared Components + State

1. Create `components/shared/` directory
2. Implement: secure-viewer, filter-bar, sidebar components
3. Create `state/app-state.ts` with signals for global state
4. Wire sidebar to use signals (first real integration)
5. **Test**: sidebar renders from signals, view switching works
6. **Deliverable**: sidebar is a Lit component, state is signal-driven

### Phase 3: Migrate Simple Views

Start with the smallest views to build confidence:

1. `<chaos-usage-view>` (~200 lines) — straightforward data display
2. `<chaos-messages-view>` (~120 lines) — simple list
3. `<chaos-files-view>` (~150 lines) — file tree + viewer
4. Each view gets its own file in `components/views/`
5. app.ts creates and mounts them based on `activeView` signal
6. **Test**: views work identically to before, state survives view switches
7. **Deliverable**: 3 views extracted, ~470 lines removed from app.ts

### Phase 4: Migrate Medium Views

1. `<chaos-dashboard>` (~380 lines) — cards, suggestions, activity
2. `<chaos-artifacts-view>` (~400 lines) — grid, detail modal, secure viewer
3. `<chaos-tasks-view>` (~330 lines) — table, timeline, scheduled tasks
4. `<chaos-hooks-view>` (~540 lines) — form, list, presets
5. **Test**: all interactions work, events fire correctly
6. **Deliverable**: 4 views extracted, ~1,650 lines removed from app.ts

### Phase 5: Migrate Complex Views

1. `<chaos-channels-view>` (~450 lines) — multiple channel type forms
2. `<chaos-agent-settings>` (~710 lines) — the biggest, most complex view
3. `<chaos-global-settings>` (~530 lines) — API keys, permissions, debug
4. Break agent-settings into sub-components: ModelSelector, SkillsManager, MemoryEditor
5. Break channels into sub-components: TelegramSetup, DiscordSetup, EmailSetup
6. **Test**: all settings save/load correctly, no regressions
7. **Deliverable**: 3 views extracted, ~1,690 lines removed from app.ts

### Phase 6: Migrate Chat

The chat view is the most complex because of streaming, columns, and real-time updates.

1. `<chaos-chat-column>` — single chat column with message list, input, progress
2. `<chaos-chat-view>` — manages multiple columns, drag-to-reorder
3. `<chaos-chat-message>` — renders a single message (user, assistant, system, error)
4. `<chaos-step-details>` — expandable step with tool calls
5. Streaming handled via reactive properties updated from port messages
6. **Test**: streaming works, columns independent, drag reorder works
7. **Deliverable**: chat fully componentized, ~500 lines removed from app.ts

### Phase 7: Shrink app.ts

After all views are extracted:

1. app.ts becomes: port connection, message routing, view switching, SDK initialization
2. Remove dead render functions
3. Remove manual DOM manipulation
4. Remove inline HTML template strings
5. app.html becomes: `<chaos-app>` root component + script tag
6. **Target**: app.ts under 1,500 lines (from 8,000)
7. **Deliverable**: clean, maintainable codebase

### Phase 8: Documentation

1. Component README for each view and primitive
2. Design system documentation with visual examples
3. Storybook or demo page showing all components
4. Migration guide for contributors
5. Update CLAUDE.md with component conventions

## Design System Documentation Structure

```
components/
  design-system/
    README.md              ← Design system overview + principles
    tokens.ts              ← Design tokens (exported constants)
    badge.ts               ← <chaos-badge> + docs
    button.ts              ← <chaos-button> + docs
    card.ts                ← <chaos-card> + docs
    field.ts               ← <chaos-field> + docs
    empty-state.ts         ← <chaos-empty-state> + docs
    icon.ts                ← <chaos-icon> + registry
    modal.ts               ← <chaos-modal> + docs
    search.ts              ← <chaos-search> + docs
    demo.html              ← Visual catalog of all components
  shared/
    README.md              ← Shared component docs
    secure-viewer.ts
    filter-bar.ts
    sidebar.ts
  views/
    README.md              ← View component docs
    dashboard.ts
    chat.ts
    tasks.ts
    ...
  state/
    README.md              ← State management docs
    app-state.ts
```

## Conventions

1. **Light DOM** — components render into Light DOM (not Shadow DOM) so existing CSS variables work
2. **Events** — components fire custom events (`@filter-change`, `@save`, etc.) instead of callbacks
3. **Properties** — use `@property()` for data passed in, `@state()` for internal state
4. **Naming** — all components prefixed with `chaos-` (custom element naming rules)
5. **Styles** — components use CSS variables from the design system, not hardcoded colors
6. **No innerHTML** — all rendering through Lit templates, never raw HTML strings
7. **File per component** — one component per file, exported as default
8. **Tests** — each component gets a test file verifying rendering and events

## Open Questions

1. **Shadow DOM vs Light DOM?** Light DOM is easier for migration (existing CSS works). Shadow DOM provides better isolation. Recommendation: Light DOM for now, Shadow DOM for primitives later.

2. **Signals library?** Lit has `@lit-labs/signals` (experimental). `@preact/signals-core` is stable and Lit-compatible. Recommendation: `@preact/signals-core` — we already reference it in the old plan.

3. **How to handle the SDK?** Components need to call `sendMsg()` and `sendPortMessage()`. Pass the SDK/port as a Lit context, or keep a singleton? Recommendation: singleton for now, Lit context later.

4. **Bundle size impact?** Lit is ~5KB. Each component adds minimal overhead. The migration should actually reduce total bundle size by eliminating duplicate template strings.

5. **Should the design system be a separate package?** Could be `@chaos/ui` for reuse in demo-web. Recommendation: start in the extension, extract later if needed.
