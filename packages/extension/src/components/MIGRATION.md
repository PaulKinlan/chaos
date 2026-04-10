# Migration Guide: Converting to Lit Components

This guide covers how to extract imperative UI code from `app.ts` into Lit components and how to use the existing component architecture.

## Converting Imperative Code to a Lit Component

### Before (imperative in app.ts)

```typescript
function renderMySection(container: HTMLElement, data: SomeData[]) {
  container.innerHTML = `
    <div class="section-header"><h2>My Section</h2></div>
    ${data.map(item => `
      <div class="item">${escapeHtml(item.name)}</div>
    `).join('')}
  `;
  container.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', () => handleClick(el));
  });
}
```

### After (Lit component)

```typescript
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg } from '../../services/messaging.js';

@customElement('chaos-my-section')
export class ChaosMySection extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Array }) data: SomeData[] = [];
  @state() private _loading = false;

  async refresh(): Promise<void> {
    this._loading = true;
    try {
      const result = await sendMsg<{ items: SomeData[] }>({ type: 'getItems' });
      this.data = result.items;
    } finally {
      this._loading = false;
    }
  }

  private _handleClick(item: SomeData) {
    this.dispatchEvent(new CustomEvent('item-selected', {
      detail: { item },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="section-header"><h2>My Section</h2></div>
      ${this._loading
        ? html`<div class="panel-spinner"><div class="spinner"></div></div>`
        : this.data.map(item => html`
            <div class="item" @click=${() => this._handleClick(item)}>
              ${item.name}
            </div>
          `)
      }
    `;
  }
}
```

### Key Differences

1. **No `innerHTML`** -- use Lit `html` templates with automatic escaping
2. **No `querySelector` + `addEventListener`** -- use `@click=${handler}` in templates
3. **No manual DOM updates** -- change `@state()` or `@property()` and the component re-renders
4. **No `escapeHtml` for text** -- Lit auto-escapes text interpolations (`${item.name}`)
5. **Events bubble up** -- parent components listen with `@item-selected=${handler}`

## Using Design System Components

The design system provides primitive components for common UI patterns:

```typescript
import '../../components/design-system/index.js';

render() {
  return html`
    <!-- Cards -->
    <chaos-card heading="Settings">
      <chaos-field label="Name" hint="Agent display name">
        <input type="text" .value=${this._name} @input=${this._onNameInput}>
      </chaos-field>
    </chaos-card>

    <!-- Badges -->
    <chaos-badge variant="green">Active</chaos-badge>
    <chaos-badge variant="red">Error</chaos-badge>

    <!-- Buttons -->
    <chaos-button variant="primary" @click=${this._save}>Save</chaos-button>
    <chaos-button variant="danger" size="sm" @click=${this._delete}>Delete</chaos-button>

    <!-- Empty states -->
    <chaos-empty-state
      heading="No items"
      description="Create one to get started."
      .icon=${ICON_REGISTRY['plus']}>
    </chaos-empty-state>

    <!-- Modals -->
    <chaos-modal heading="Confirm" .open=${this._showModal} @close=${this._closeModal}>
      <p>Are you sure?</p>
    </chaos-modal>

    <!-- Search -->
    <chaos-search placeholder="Filter..." @search=${this._onSearch}></chaos-search>

    <!-- Icons -->
    <chaos-icon name="settings" size="20"></chaos-icon>
  `;
}
```

## Handling Events Between Components

### Child fires event

```typescript
// In child component:
this.dispatchEvent(new CustomEvent('save-complete', {
  detail: { id: this._itemId },
  bubbles: true,
  composed: true,
}));
```

### Parent listens

```typescript
// In parent template:
html`<chaos-my-child @save-complete=${this._onSaveComplete}></chaos-my-child>`;

// Handler:
private _onSaveComplete(e: CustomEvent<{ id: string }>) {
  console.log('Saved:', e.detail.id);
}
```

### Cross-view communication

Views communicate via `app.ts` as an intermediary. A view fires an event, `app.ts` catches it and updates signals or calls methods on other views:

```typescript
// View fires:
this.dispatchEvent(new CustomEvent('view-change', {
  detail: { view: 'chat', prompt: 'Research this topic' },
  bubbles: true,
}));

// app.ts handles:
element.addEventListener('view-change', (e: CustomEvent) => {
  activeView.value = e.detail.view;
  if (e.detail.prompt) {
    // Send prompt to chat
  }
});
```

## Common Pitfalls

### Shadow DOM

Every component MUST use Light DOM:

```typescript
createRenderRoot() { return this; }
```

Without this, your component renders into Shadow DOM and loses all CSS styling from `app.html`. The existing CSS classes (`.settings-card`, `.badge`, `.btn`, etc.) will not apply.

### Global State

Do not store state in global variables or `window`. Use either:
- `@state()` for component-local state
- Signals in `state/app-state.ts` for state shared across components
- `@property()` for data passed from parent to child

### Async Data and Loading States

Always show loading indicators during async operations:

```typescript
@state() private _loading = false;

async refresh() {
  this._loading = true;
  try {
    const data = await sendMsg({ type: 'getData' });
    this._data = data;
  } catch (err) {
    console.error('[my-component] Error:', err);
  } finally {
    this._loading = false;
  }
}

render() {
  if (this._loading) {
    return html`<div class="panel-spinner"><div class="spinner"></div></div>`;
  }
  // ... render data
}
```

### Content Security

Never use `innerHTML` with user or agent-generated content. For rendering untrusted HTML/markdown, use `createSecureViewer()` from `ui/secure-viewer.ts` which uses a double iframe sandbox.

Lit's `html` templates auto-escape text, but `unsafeHTML` does NOT. Only use `unsafeHTML` for trusted content like SVG icons from `ICON_REGISTRY`.

### Event Cleanup

Lit handles event listener cleanup automatically for template-bound handlers (`@click=${fn}`). However, if you add manual event listeners in `connectedCallback`, remove them in `disconnectedCallback`:

```typescript
connectedCallback() {
  super.connectedCallback();
  this._handler = (e: Event) => this._onSomething(e);
  window.addEventListener('resize', this._handler);
}

disconnectedCallback() {
  super.disconnectedCallback();
  window.removeEventListener('resize', this._handler);
}
```

### Timer Cleanup

Clear intervals and timeouts in `disconnectedCallback`:

```typescript
disconnectedCallback() {
  super.disconnectedCallback();
  if (this._refreshTimer) {
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }
}
```
