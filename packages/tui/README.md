# @chaos/tui — Multi-Agent Terminal Interface

A TweetDeck-style terminal UI for interacting with multiple AI agents simultaneously. Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and [@chaos/agent-loop](../agent-loop/).

## Features

- **Multi-column layout** — multiple agents side by side, like TweetDeck
- **Tab switching** — Tab/Shift+Tab to move between columns
- **Dynamic agents** — Ctrl+N to create, Ctrl+D to delete
- **OS tools** — agents can read/write files, run commands, search code
- **Streaming** — real-time tool calls and text output
- **Any provider** — Anthropic, Google, OpenAI, or Ollama

## Quick Start

```bash
# From the monorepo root
cd packages/tui
npm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run
npx tsx src/index.tsx
```

## Options

```
--provider <name>   anthropic | google | openai | ollama (default: anthropic)
--model <id>        Model ID (default: provider-specific)
--agent <name>      Initial agent name (repeat for multiple columns)
```

## Examples

```bash
# Single assistant
npx tsx src/index.tsx

# Three specialized agents
npx tsx src/index.tsx --agent Researcher --agent Coder --agent Reviewer

# Use Gemini
npx tsx src/index.tsx --provider google --model gemini-2.5-flash

# Use local Ollama
npx tsx src/index.tsx --provider ollama --model llama3.2
```

## Keybindings

| Key | Action |
|-----|--------|
| Tab | Focus next agent column |
| Shift+Tab | Focus previous column |
| Ctrl+N | Create a new agent |
| Ctrl+D | Delete focused agent |
| Esc | Abort current generation |
| Ctrl+C | Quit |

## Agent Tools

Each agent has access to:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file from the working directory |
| `write_file` | Write/create a file |
| `edit_file` | Find-and-replace in a file |
| `list_directory` | List directory contents |
| `run_command` | Execute a shell command |
| `search_files` | Grep for patterns in files |
| `file_info` | Get file metadata |
| `watch_directory` | Show recently modified files |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ CHAOS TUI                            ~/my-project   │
├─────────────┬──────────────┬────────────────────────┤
│ Researcher  │ Coder        │ Reviewer              │
│             │              │                        │
│ > find all  │ > fix the    │ > review the          │
│   API calls │   auth bug   │   PR changes          │
│             │              │                        │
│ Found 12    │ Using:       │ Looking at             │
│ endpoints   │ edit_file... │ git diff...            │
│ in src/...  │              │                        │
│─────────────│──────────────│────────────────────────│
│ > _         │ > _          │ > _                    │
├─────────────┴──────────────┴────────────────────────┤
│ Tab:switch  Ctrl+N:new  Ctrl+D:del  anthropic [1/3] │
└─────────────────────────────────────────────────────┘
```
