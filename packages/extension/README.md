# CHAOS Chrome Extension

**C**hrome **A**gent **O**perating **S**ystem -- a Chrome extension that runs multiple personal AI agents in your browser. Agents have persistent memory, can communicate with each other, execute browser actions via tools, and connect to external channels (Telegram, Discord, email, webhooks) through the CHAOS relay server.

## Building

```bash
npm install       # Install dependencies (from monorepo root or this directory)
npm run build     # TypeScript check + Vite build + build validation
```

The built extension is output to `dist/`.

## Loading in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist/` directory

## Development

```bash
npm run dev       # Start Vite dev server with HMR
npm run typecheck # TypeScript type checking only (no emit)
```

After making changes, the extension auto-reloads via the Vite dev server. For manifest or service worker changes, you may need to manually reload the extension from `chrome://extensions`.

## Key Features

- **Multi-agent system** -- Create and manage multiple AI agents, each with their own personality, instructions, and memory
- **TweetDeck-style columns** -- Chat with multiple agents side-by-side in a column layout
- **Persistent memory** -- Agents store memories, activity logs, and TODO lists in OPFS (Origin Private File System)
- **Hooks** -- Agents can react to browser events (tab changes, bookmarks, navigation, alarms, idle state, etc.)
- **Channels** -- Connect agents to external services (Telegram, Discord, email, webhooks) via the relay server
- **Skills** -- Installable skill manifests that extend agent capabilities
- **Browser tools** -- Agents can read pages, manage tabs, search bookmarks/history, take screenshots, and more
- **Usage tracking** -- Token usage monitoring across providers
- **Voice input** -- Voice-to-text input for agent conversations
- **Omnibox** -- Type `chaos` in the address bar to interact with agents
- **Context menus** -- Right-click to send page content or selections to agents
- **Inter-agent messaging** -- Agents can send messages to each other via a shared message bus

## Architecture

The extension is built as a Manifest V3 Chrome extension using Vite for bundling.

### Entry Points

| File | Role |
|------|------|
| `src/background.ts` | Service worker. Message routing, alarm handling, hook listeners, channel polling, context menus, agent lifecycle. |
| `src/app.ts` | Main dashboard UI (opened on extension icon click or `Ctrl+Shift+C`). Agent tabs, chat columns, task board, settings. |
| `src/popup.ts` | Minimal popup that redirects to the main app. |
| `src/sidepanel.ts` | Side panel interface (alternative to the main app). |
| `src/content/` | Content scripts for page extraction (Readability + Turndown). |
| `src/offscreen-parser.ts` | Offscreen document for DOM parsing when content scripts are unavailable. |

### Storage

- **IndexedDB** -- Conversations, page cache, embeddings, WASM tool data
- **OPFS** -- Per-agent files: `CLAUDE.md` (instructions), `memories/`, `activity-log`, `TODO.md`; shared files: `messages.jsonl`, `tasks.jsonl`, `artifacts.jsonl`
- **Chrome Storage** -- Extension settings, agent metadata

### Key Directories

```
src/
  agents/         Agent lifecycle, creation, memory management
  channels/       External channel integration (relay server client)
  context/        Context gathering (page content, selections)
  hooks/          Browser event hook system
  storage/        IndexedDB, OPFS, and Chrome storage helpers
  tools/          Browser action tools available to agents
  ui/             UI components and rendering
  voice/          Voice input (speech recognition)
  __tests__/      Unit and e2e tests
```

## Testing

```bash
npm test              # Run unit tests (vitest)
npm run test:unit     # Same as above
npm run test:e2e      # Run end-to-end tests (Puppeteer)
npm run test:watch    # Watch mode
```

## Packaging

```bash
npm run extension:zip   # Build and create chaos-extension.zip
```

## Permissions

The extension requests minimal permissions by default (`activeTab`, `storage`, `alarms`, `contextMenus`, `offscreen`) and uses optional permissions for enhanced features (`tabs`, `bookmarks`, `history`, `scripting`, `notifications`, `downloads`, `readingList`, `idle`, `clipboardRead`, `clipboardWrite`). Agents check for permissions before using Chrome APIs.

## License

Apache 2.0
