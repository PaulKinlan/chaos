# Hooks and Permissions Guide

## Lifecycle Hooks

Hooks let you observe and control the agent at every stage of execution. All hooks are optional and async.

### Hook Types

#### `onStepStart`

Called at the beginning of each agent iteration, before the model is called.

```typescript
hooks: {
  onStepStart: async (event) => {
    console.log(`Starting step ${event.step}/${event.totalSteps}`);
    console.log(`Tokens so far: ${event.tokensSoFar}, cost: $${event.costSoFar.toFixed(4)}`);

    // Stop the agent early
    if (event.costSoFar > 1.0) {
      return { decision: 'stop', reason: 'Budget exceeded' };
    }

    // Continue normally (or return nothing)
    return { decision: 'continue' };
  },
}
```

#### `onPreToolUse`

Called before each tool execution. You can allow, deny, or modify the tool call.

```typescript
hooks: {
  onPreToolUse: async (event) => {
    console.log(`Tool: ${event.toolName}, step: ${event.step}`);
    console.log('Args:', event.args);

    // Deny dangerous operations
    if (event.toolName === 'run_command') {
      const args = event.args as { command: string };
      if (args.command.includes('rm -rf')) {
        return { decision: 'deny', reason: 'Destructive command blocked' };
      }
    }

    // Modify arguments
    if (event.toolName === 'write_file') {
      return {
        decision: 'allow',
        modifiedArgs: {
          ...(event.args as Record<string, unknown>),
          content: addCopyrightHeader((event.args as any).content),
        },
      };
    }

    // Allow by default
    return { decision: 'allow' };
  },
}
```

#### `onPostToolUse`

Called after each tool execution completes. Observation-only (no decision to return).

```typescript
hooks: {
  onPostToolUse: async (event) => {
    console.log(`${event.toolName} completed in ${event.durationMs}ms`);
    console.log('Result:', event.result);

    // Log to your analytics
    await analytics.track('tool_use', {
      tool: event.toolName,
      duration: event.durationMs,
      step: event.step,
    });
  },
}
```

#### `onStepComplete`

Called after each iteration of the agent loop completes.

```typescript
hooks: {
  onStepComplete: async (event) => {
    console.log(`Step ${event.step} complete`);
    console.log(`Had tool calls: ${event.hasToolCalls}`);
    if (event.text) {
      console.log(`Text output: ${event.text.slice(0, 100)}...`);
    }
  },
}
```

#### `onComplete`

Called when the agent finishes, whether by completing the task, hitting max iterations, or being aborted.

```typescript
hooks: {
  onComplete: async (event) => {
    console.log(`Agent finished in ${event.totalSteps} steps`);
    console.log(`Aborted: ${event.aborted}`);
    console.log(`Total cost: $${event.usage.totalCost.toFixed(4)}`);
    console.log(`Tokens: ${event.usage.totalInputTokens} in, ${event.usage.totalOutputTokens} out`);

    // Save the result
    await db.insert('runs', {
      result: event.result,
      steps: event.totalSteps,
      cost: event.usage.totalCost,
    });
  },
}
```

#### `onUsage`

Called after each step's usage is recorded. Useful for real-time cost monitoring.

```typescript
hooks: {
  onUsage: async (record) => {
    console.log(`Step ${record.step}: ${record.inputTokens} in, ${record.outputTokens} out`);
    console.log(`Cost: $${record.estimatedCost.toFixed(6)}, model: ${record.model}`);

    // Persist to usage database
    await usageDb.record(record);
  },
}
```

## Hook Decisions

Hooks that can control execution (`onPreToolUse`, `onStepStart`) return a `HookDecision`:

| Decision | Effect |
|----------|--------|
| `'allow'` | Continue normally |
| `'deny'` | Block the tool call (onPreToolUse only). The tool returns an error message to the model. |
| `'ask'` | Defer to the permission system |
| `'stop'` | Stop the agent loop entirely |
| `'continue'` | Same as `'allow'` |

You can also modify tool arguments by including `modifiedArgs` in the decision (onPreToolUse only).

If a hook returns `void` or `undefined`, execution continues normally.

## Permission System

Permissions control which tools the agent can call. They are evaluated *before* the `onPreToolUse` hook.

### Permission Modes

| Mode | Behavior |
|------|----------|
| `'accept-all'` | Allow all tools by default (per-tool `'never'` overrides still apply) |
| `'deny-all'` | Deny all tools by default (per-tool `'always'` overrides still apply) |
| `'ask'` | Check per-tool overrides, then call `onPermissionRequest` callback |

### Per-Tool Overrides

Override the global mode for specific tools:

```typescript
permissions: {
  mode: 'ask',
  tools: {
    read_file: 'always',    // Always allowed, even in 'deny-all' mode
    write_file: 'ask',      // Defers to onPermissionRequest
    delete_file: 'never',   // Always denied, even in 'accept-all' mode
  },
}
```

### Permission Evaluation Pipeline

1. Check global mode:
   - `'accept-all'`: allow (but still check for per-tool `'never'`)
   - `'deny-all'`: deny (but still check for per-tool `'always'`)
2. Check per-tool override:
   - `'always'`: allow
   - `'never'`: deny
3. Call `onPermissionRequest` callback (if provided)
4. Default to allow if no callback

### Custom Permission Handler

```typescript
permissions: {
  mode: 'ask',
  onPermissionRequest: async ({ toolName, args }) => {
    // Log all permission requests
    console.log(`Permission requested: ${toolName}`, args);

    // Check an allowlist
    if (allowedTools.has(toolName)) return true;

    // Ask the user interactively
    const answer = await readline.question(`Allow ${toolName}? (y/n) `);
    return answer.toLowerCase() === 'y';
  },
}
```

## Combining Hooks and Permissions

Hooks and permissions work together in this order for each tool call:

1. **Permission check** (`evaluatePermission`) -- if denied, the tool returns an error
2. **onPreToolUse hook** -- can deny, modify args, or stop the agent
3. **Tool execution** -- the actual tool runs
4. **onPostToolUse hook** -- observes the result

```typescript
const agent = createAgent({
  id: 'guarded-agent',
  name: 'Guarded Agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: { /* ... */ },
  permissions: {
    mode: 'accept-all',
    tools: {
      dangerous_tool: 'never', // Hard block at permission level
    },
  },
  hooks: {
    onPreToolUse: async (event) => {
      // Additional validation even for permitted tools
      if (event.toolName === 'write_file') {
        const args = event.args as { path: string };
        if (args.path.startsWith('/etc/')) {
          return { decision: 'deny', reason: 'Cannot write to /etc' };
        }
      }
    },
  },
});
```
