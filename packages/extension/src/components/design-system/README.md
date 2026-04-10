# CHAOS Design System

Primitive UI components built with [Lit](https://lit.dev/) for the CHAOS Chrome extension. All components use **Light DOM** rendering so they inherit existing CSS variables and classes from `app.html`.

## Architecture

- Components are Web Components (custom elements) registered with the `chaos-` prefix
- All styling comes from CSS variables and classes already defined in `app.html`
- No Shadow DOM — `createRenderRoot() { return this; }` on every component
- Components are side-effect imports: importing registers them globally

## Components

### `<chaos-icon>`

Renders an inline SVG icon from a built-in registry.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `''` | Icon name (key in `ICON_REGISTRY`) |
| `size` | `number` | `16` | Width and height in pixels |

```html
<chaos-icon name="chat" size="20"></chaos-icon>
<chaos-icon name="settings"></chaos-icon>
```

Available icons: chat, tasks, artifacts, channels, hooks, usage, settings, dashboard, memory, messages, search, close, download, copy, pin, pin-filled, star, plus, trash, edit, refresh, check, error, spinner, chevron-right, chevron-down, external-link, file, folder, send, delegate, microphone, drag-handle, user, clock, check-circle, lightbulb, sparkle, tab, bookmark, history, circle-plus, undo, shield, key, arrow-right, arrow-left.

### `<chaos-badge>`

A small status/category label.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `variant` | `string` | `'gray'` | One of: `info`, `active`, `blue`, `purple`, `amber`, `green`, `red`, `gray` |

```html
<chaos-badge variant="green">Enabled</chaos-badge>
<chaos-badge variant="red">Error</chaos-badge>
```

Uses CSS classes `.badge` and `.badge-{variant}`.

### `<chaos-button>`

A styled button with variant and size options.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `variant` | `string` | `'ghost'` | One of: `primary`, `danger`, `ghost` |
| `size` | `string` | `'md'` | One of: `xs`, `sm`, `md` |
| `disabled` | `boolean` | `false` | Disables the button |
| `loading` | `boolean` | `false` | Shows spinner, disables button |

```html
<chaos-button variant="primary" @click=${save}>Save</chaos-button>
<chaos-button variant="danger" size="sm">Delete</chaos-button>
<chaos-button loading>Saving...</chaos-button>
```

Uses CSS classes `.btn`, `.btn-{variant}`, `.btn-{size}`.

### `<chaos-card>`

A container for settings panels and dashboard sections.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | `string` | `undefined` | Optional heading rendered as `<h3>` |
| `interactive` | `boolean` | `false` | Adds pointer cursor |

```html
<chaos-card heading="API Keys">
  <p>Configure your API keys.</p>
</chaos-card>
```

Uses CSS class `.settings-card`.

### `<chaos-field>`

Label + input wrapper for form fields.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `''` | Label text |
| `hint` | `string` | `undefined` | Hint text below label |
| `error` | `string` | `undefined` | Error message below input |

```html
<chaos-field label="API Key" hint="Get one from anthropic.com">
  <input type="text" .value=${key}>
</chaos-field>
```

Uses CSS class `.settings-field`.

### `<chaos-empty-state>`

Placeholder for empty lists or views.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | `string` | `''` | Title text |
| `description` | `string` | `''` | Description text |
| `icon` | `string` | `undefined` | SVG string (from `ICON_REGISTRY`) |

```html
<chaos-empty-state
  heading="No artifacts yet"
  description="Artifacts will appear here."
  .icon=${ICON_REGISTRY['artifacts']}>
</chaos-empty-state>
```

Uses CSS classes `.empty-state`, `.empty-state-icon`.

### `<chaos-modal>`

Modal dialog wrapping native `<dialog>`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `open` | `boolean` | `false` | Controls visibility |
| `heading` | `string` | `''` | Modal title |

| Event | Description |
|-------|-------------|
| `close` | Fired when modal is dismissed |

```html
<chaos-modal heading="Confirm" .open=${showModal} @close=${onClose}>
  <p>Are you sure?</p>
  <chaos-button variant="danger" @click=${confirm}>Yes</chaos-button>
</chaos-modal>
```

### `<chaos-search>`

Search/filter input that fires events on keystroke.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `placeholder` | `string` | `'Search...'` | Placeholder text |
| `value` | `string` | `''` | Current value |

| Event | Detail | Description |
|-------|--------|-------------|
| `search` | `string` | Fired on every input with current value |

```html
<chaos-search placeholder="Filter tasks..." @search=${onFilter}></chaos-search>
```

## Design Tokens

Import `tokens` from `./tokens.js` for documented CSS variable references:

```typescript
import { tokens } from './tokens.js';
// tokens.bgSurface === 'var(--bg-surface)'
```

## Adding New Icons

Add entries to `ICON_REGISTRY` in `icon.ts`. All icons should:
- Use a `0 0 24 24` viewBox
- Use `stroke="currentColor"` (not hardcoded colors)
- Use `stroke-width="2"` with `round` line caps/joins
- Omit `width`/`height` attributes (set dynamically by the component)
