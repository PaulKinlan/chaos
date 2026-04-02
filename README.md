# CHAOS - Chrome Agent OS

Multiple personal AI agents that live in your browser, learn about you, and act on your behalf.

Built on concepts from [emaila.gent](https://github.com/PaulKinlan/emaila.gent) (multi-agent learning system), [co-do](https://github.com/PaulKinlan/co-do) (sandboxed tool execution), [NotebookLM-Chrome](https://github.com/PaulKinlan/NotebookLM-Chrome) (content extraction and safe rendering), and [infinitron.com](https://infinitron.com).

See [docs/architecture.md](docs/architecture.md) for the full design and [docs/prd.md](docs/prd.md) for product requirements.

## Features

- **Multiple agents** with role templates (neutral, researcher, coder, writer, planner, reviewer)
- **Self-evolving personality** - agents edit their own CLAUDE.md as they learn about you
- **60+ tools** - Chrome APIs (tabs, bookmarks, history, windows, downloads), file operations, web search, WASM tools, inter-agent communication
- **Agentic loop** - autonomous multi-step task execution with progress streaming
- **Hooks** - event-driven agent execution (bookmark created, tab navigated, download completed, idle state, omnibox, etc.)
- **Scheduled tasks** - alarm-based recurring work with stored prompts
- **@ mentions** - pull in browser context inline (@tab, @bookmark, @history, @agent)
- **Voice input** - speech-to-text via iframe recognition frame
- **Inter-agent communication** - message bus, shared task board, artifact sharing
- **Per-agent tool configuration** - enable/disable tools per agent
- **OPFS file explorer** - browse agent memory files
- **Light/dark mode** - system auto-detect + manual override
- **Multi-provider** - Anthropic Claude, Google Gemini, OpenAI, OpenRouter with provider-native search grounding

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

## Status

Active development. Functional as a Chrome extension with new tab page interface.
