# Tools Guide

## Vercel AI SDK tool() Basics

Tools in `@chaos/agent-loop` use the Vercel AI SDK's `tool()` function. Each tool needs a description, an input schema (using Zod), and an execute function:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: 'A human-readable description of what the tool does.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results'),
  }),
  execute: async ({ query, limit }) => {
    // Do something and return a result (string or serializable object)
    return `Found ${limit ?? 10} results for "${query}"`;
  },
});
```

Pass tools to `createAgent` via the `tools` config:

```typescript
const agent = createAgent({
  id: 'my-agent',
  name: 'My Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: {
    search: myTool,
    calculate: calculatorTool,
  },
});
```

## Built-in File Tools

`@chaos/agent-loop` ships with `createFileTools()` which creates a full set of file-manipulation tools backed by any `MemoryStore` from `@chaos/sdk`:

```typescript
import { createAgent, createFileTools } from '@chaos/agent-loop';
import { InMemoryMemoryStore } from '@chaos/sdk/stores/in-memory';

const memoryStore = new InMemoryMemoryStore();

const agent = createAgent({
  id: 'file-agent',
  name: 'File Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: {
    ...createFileTools(memoryStore, 'file-agent'),
  },
});
```

This provides six tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents at a given path |
| `write_file` | Write content to a file (creates parent directories) |
| `list_directory` | List files and directories at a path |
| `delete_file` | Delete a file |
| `grep_file` | Search for a text pattern across files |
| `find_files` | Recursively list all files from a starting path |

## Custom Tool Examples

### Web Scraper Tool

```typescript
const scrape_url = tool({
  description: 'Fetch and return the text content of a web page.',
  inputSchema: z.object({
    url: z.string().url().describe('URL to scrape'),
  }),
  execute: async ({ url }) => {
    const res = await fetch(url);
    const html = await res.text();
    // Strip HTML tags for a simple text extraction
    return html.replace(/<[^>]*>/g, '').slice(0, 5000);
  },
});
```

### Database Query Tool

```typescript
const query_db = tool({
  description: 'Run a read-only SQL query against the database.',
  inputSchema: z.object({
    sql: z.string().describe('SQL query to execute'),
  }),
  execute: async ({ sql }) => {
    if (!sql.trim().toLowerCase().startsWith('select')) {
      return 'Error: Only SELECT queries are allowed.';
    }
    const rows = await db.query(sql);
    return JSON.stringify(rows, null, 2);
  },
});
```

### Shell Command Tool

```typescript
import { execSync } from 'child_process';

const run_command = tool({
  description: 'Run a shell command and return its output.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to run'),
  }),
  execute: async ({ command }) => {
    try {
      return execSync(command, { encoding: 'utf-8', timeout: 10000 });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});
```

## Tool Permissions

Every tool call passes through the permission system before execution. Configure permissions per-tool:

```typescript
const agent = createAgent({
  id: 'safe-agent',
  name: 'Safe Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: {
    read_file: readFileTool,
    write_file: writeFileTool,
    run_command: shellTool,
  },
  permissions: {
    mode: 'ask',
    tools: {
      read_file: 'always',       // Never prompt
      write_file: 'ask',         // Ask via callback
      run_command: 'never',      // Always deny
    },
    onPermissionRequest: async ({ toolName, args }) => {
      console.log(`Agent wants to use ${toolName} with:`, args);
      return true; // or false to deny
    },
  },
});
```

See the [Hooks and Permissions guide](./hooks-and-permissions.md) for the full permission evaluation pipeline.

## Combining Tools with Skills

Tools and skills work together. Skills inject instructions into the system prompt, while tools give the agent executable capabilities. You can also use `createSkillTools()` to let the agent install and manage skills at runtime -- see the [Skills guide](./skills.md).
