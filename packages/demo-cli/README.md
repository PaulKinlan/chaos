# @chaos/demo-cli

A minimal CLI reference implementation proving the `@chaos/sdk` works entirely outside a browser. No Chrome APIs, no DOM — just Node.js and TypeScript.

## What this proves

- The SDK's store interfaces (`MemoryStore`, `SettingsStore`) work with real filesystem I/O
- The `EngineConnection` interface can be implemented with a simple mock
- `ChaosSDK` can be instantiated and used in a Node.js process
- Agent CRUD, chat streaming, hooks, and usage tracking all work without a browser

## Stores

| Store | Implementation | Backing |
|-------|---------------|---------|
| `MemoryStore` | `NodeFileStore` | `fs/promises` under `~/.chaos-data/memory/` |
| `SettingsStore` | `JsonSettingsStore` | Single JSON file at `~/.chaos-data/settings.json` |
| `ConversationStore` | `InMemoryConversationStore` | In-memory (from SDK) |
| `HookStore` | `InMemoryHookStore` | In-memory (from SDK) |
| `UsageStore` | `InMemoryUsageStore` | In-memory (from SDK) |
| `AgentStore` | `InMemoryAgentStore` | In-memory (from SDK) |

## Usage

```bash
# From the repo root
npm install
npm run dev --workspace=packages/demo-cli -- agents create "Research Assistant"
npm run dev --workspace=packages/demo-cli -- agents create "Claude Agent" --provider anthropic
npm run dev --workspace=packages/demo-cli -- agents list
npm run dev --workspace=packages/demo-cli -- agents archive <id>
npm run dev --workspace=packages/demo-cli -- chat agent-id "Hello"
npm run dev --workspace=packages/demo-cli -- help
```

## Commands

```
chaos agents list                          List all agents (excludes archived)
chaos agents create <name>                 Create a new agent
chaos agents create <name> --provider <p>  Create an agent with a specific provider
chaos agents delete <id>                   Delete an agent by ID
chaos agents archive <id>                  Archive an agent (preserves memory)
chaos agents restore <id>                  Restore an archived agent
chaos agents memory <id>                   Show agent memory files
chaos chat <agent-id> <msg>                Send a message and stream the response
chaos conversations list <agent-id>        List conversations for an agent
chaos conversations get <agent-id> <id>    Get a conversation by ID
chaos hooks list                           List all hooks
chaos hooks create                         Create a sample hook
chaos usage summary                        Show usage summary
chaos help                                 Show this help message
```
