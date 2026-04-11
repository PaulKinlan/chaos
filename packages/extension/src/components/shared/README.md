# CHAOS Shared Components

Reusable complex components used across multiple views. All components render into Light DOM.

## `<chaos-sidebar>`

Main navigation sidebar. Reads global signals directly via `SignalWatcher`.

**Signal dependencies:** `activeView`, `agents`, `activeAgentId`

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `view-change` | `string` (view name) | User clicked a navigation item |
| `agent-change` | `string` (agent ID) | User selected an agent |
| `create-agent` | none | User clicked the "+" button to create a new agent |

**Behavior:**

- Renders navigation items: Dashboard, Chat, Jobs, Artifacts, Channels, Hooks, Usage
- Shows agent list with expandable sub-navigation (Memory, Settings, Jobs, Messages)
- Bottom section contains the global Settings link
- Double-clicking an agent name navigates to that agent's chat
- Clicking a sub-item under an agent sets both `activeAgentId` and `activeView` signals

---

## `<chaos-filter-bar>`

Reusable filter bar with dropdown selects and optional search input.

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `filters` | `FilterConfig[]` | `[]` | Array of filter configurations |
| `searchPlaceholder` | `string` | `undefined` | If set, shows a search input |
| `searchValue` | `string` | `''` | Current search input value |

**FilterConfig format:**

```typescript
interface FilterConfig {
  id: string;                                    // Unique filter identifier
  label: string;                                 // Display label
  options: Array<{ value: string; label: string }>; // Dropdown options
  value?: string;                                // Currently selected value
}
```

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `filter-change` | `{ filterId: string, value: string }` | A dropdown selection changed |
| `search` | `string` (query text) | Search input changed |

---

## `<chaos-chat-message>`

Renders a single chat message bubble with role-based styling.

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `role` | `string` | `'user'` | Message role: `user`, `assistant`, `system`, `error`, `tool-call` |
| `streaming` | `boolean` | `false` | Whether this message is currently being streamed (adds pulsing animation) |

**Slots:** Default slot for message content.

**CSS classes applied:** `chat-message`, plus the role name, plus `thinking-stream active` when streaming.

---

## `<chaos-step-details>`

Expandable agentic step indicator. Shows a collapsible details element with a step badge and status.

**Properties:**

| Property | Type | Default | Attribute | Description |
|----------|------|---------|-----------|-------------|
| `step` | `number` | `1` | `step` | Step number (1-based) |
| `totalSteps` | `number` | `0` | `total-steps` | Total steps (0 = unknown, shows "Step N" instead of "Step N of M") |
| `status` | `string` | `'working...'` | `status` | Status text next to the badge |
| `open` | `boolean` | `false` | `open` | Whether the details element is expanded |

**Slots:** Default slot for step body content (tool calls, details, etc.)

**CSS classes:** `step-details`, `step-summary`, `step-badge`, `step-status`, `step-content`

---

## `<chaos-artifact-detail>`

Full-screen artifact detail viewer with secure content rendering, pin/download/delete actions.

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `artifact` | `ArtifactMeta \| null` | `null` | The artifact to display |
| `content` | `string` | `''` | The artifact's raw content |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `close` | none | User dismissed the detail view |
| `pin` | `{ artifact: ArtifactMeta }` | Toggle pin status |
| `delete` | `{ artifact: ArtifactMeta }` | Delete the artifact |

**Key behavior:**
- Renders content in a secure double-iframe sandbox (via `createSecureViewer`)
- Detects content type (HTML, markdown, JSON, CSV, text) and renders appropriately
- Download button generates a file with appropriate extension
- Copy button copies raw content to clipboard

---

## `<chaos-chat-input>`

Chat text input area with send/stop toggle button.

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disables input and button |
| `streaming` | `boolean` | `false` | When true, send button becomes stop button (X icon) |
| `placeholder` | `string` | `'Type a message...'` | Textarea placeholder |
| `value` | `string` | `''` | Current input value |

**Events:**

| Event | Detail | Description |
|-------|--------|-------------|
| `send` | `string` (message text) | User submitted a message (Enter key or click send) |
| `stop` | none | User clicked stop during streaming |

**Behavior:**

- Enter sends the message (Shift+Enter for newline)
- Send button is disabled when input is empty (unless streaming, where it becomes stop)
- Input value is cleared after sending
