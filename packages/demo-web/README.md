# CHAOS SDK Web Demo

A minimal vanilla HTML+JS reference implementation proving the `@chaos/sdk` works in any browser without Chrome extension APIs.

## What this is

A standalone single-page app that wires up the full CHAOS SDK with:

- **In-memory stores** (`@chaos/sdk/stores`) -- no IndexedDB, no chrome.storage
- **Mock engine connection** -- returns canned responses, no real LLM calls
- **Standard DOM** -- no React, no framework, just TypeScript and the browser

## How to run

```bash
cd packages/demo-web
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## What it demonstrates

1. **SDK initialization** with pluggable stores and engine
2. **Agent CRUD** -- create, list, select, delete agents via `sdk.agents`
3. **Agentic chat streaming** -- send messages via `sdk.chat.sendAgentic()` and consume the async iterator of `ProgressUpdate` events (thinking, tool calls, text, done)
4. **Event system** -- every SDK event (agent created/deleted, chat chunks, tool calls, errors) is captured via `addEventListener` and rendered in the activity log

## How it differs from the real extension

| | Extension | This demo |
|---|---|---|
| Stores | `chrome.storage.local` | In-memory Maps |
| Engine | Real LLM via background service worker | Mock with canned responses |
| Browser APIs | Tabs, bookmarks, history, etc. | None |
| UI framework | Lit web components | Vanilla DOM |

The SDK itself is identical in both cases -- that is the point.
