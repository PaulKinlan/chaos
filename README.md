# CHAOS - Chrome Agent OS

Multiple personal AI agents that live in your browser, learn about you, and act on your behalf.

Built on concepts from [emaila.gent](https://github.com/PaulKinlan/emaila.gent) (multi-agent learning system), [co-do](https://github.com/PaulKinlan/co-do) (sandboxed tool execution), [NotebookLM-Chrome](https://github.com/PaulKinlan/NotebookLM-Chrome) (content extraction and safe rendering), and [infinatron.com](https://infinatron.com).

See [docs/architecture.md](docs/architecture.md) for the full design and [docs/prd.md](docs/prd.md) for product requirements.

## Features

- **Master agent model** - first agent is the master with sub-agent management tools (create, assign, find, delete agents)
- **Multiple agents** with role templates (master, researcher, coder, writer, planner, reviewer)
- **Self-evolving personality** - agents edit their own CLAUDE.md as they learn about you
- **69+ tools** - Chrome APIs (31), file operations (11), communication (10), WASM (7), master (5), hooks (3), web (2), plus provider search grounding
- **Multi-column TweetDeck chat** - side-by-side conversation columns, multiple per agent, [+] to add
- **Agentic loop** - autonomous multi-step execution with streamText, real-time streaming, collapsible progress with tool results, persisted to history
- **Hook-driven context menus** - hooks create context menu items that open chat columns with progress
- **Hooks** - 14 trigger types (bookmark, tab, download, history, idle, omnibox, reading list, window events, context menu, browser startup) with preset palette and bookmark folder picker
- **Content extraction** - Readability + Turndown via content script (tab_read with three-tier fallback) and offscreen document (fetch_page)
- **Provider search grounding** - Google, OpenAI, Anthropic native search tools
- **Scheduled tasks** - alarm-based recurring work with stored prompts
- **@ mentions** - autocomplete for @tab, @bookmark, @history, @agent with content resolution
- **Voice input** - iframe-based recognition frame, global hotkey Ctrl+Shift+U
- **Refine prompt** - LLM-powered prompt refinement with before/after dialog
- **Inter-agent communication** - message bus, shared task board, artifact sharing
- **Per-agent tool configuration** - enable/disable tools per agent
- **OPFS file explorer** - browse agent memory files
- **Light/dark mode** - system auto-detect + manual override
- **Hash-based routing** - state persists across refresh
- **Multi-provider** - Anthropic Claude, Google Gemini, OpenAI, OpenRouter
- **Defensive data migration** - sync/local fallback, optional fields, no destructive updates

## Getting started

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Development

```bash
npm run dev          # Vite dev server
npm test             # Run unit + integration tests (288 tests)
npm run test:e2e     # Run Puppeteer e2e tests (requires build)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, how to run tests, build the extension, and submit PRs. Development guidelines and code style rules are in [CLAUDE.md](CLAUDE.md).

## Status

Active development. Functional as a Chrome extension. Opens via icon click or Ctrl+Shift+C hotkey in a regular tab (not a new tab page override).
