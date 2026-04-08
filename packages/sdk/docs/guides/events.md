# Events Guide

All domain APIs in the SDK extend `EventTarget` and emit `CustomEvent` instances. Use standard `addEventListener` / `removeEventListener` to observe state changes.

## Basic Pattern

```typescript
sdk.agents.addEventListener('created', (e) => {
  const agent = (e as CustomEvent).detail;
  console.log(`Agent created: ${agent.name} (${agent.id})`);
});
```

To remove a listener:

```typescript
const handler = (e: Event) => {
  const { agentId } = (e as CustomEvent).detail;
  console.log(`Deleted: ${agentId}`);
};

sdk.agents.addEventListener('deleted', handler);
// Later:
sdk.agents.removeEventListener('deleted', handler);
```

## Events by Domain API

### AgentsAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `created` | `AgentMeta` | Agent was created |
| `updated` | `{ agentId: string, updates: Partial<AgentMeta> }` | Agent metadata was updated |
| `deleted` | `{ agentId: string }` | Agent was deleted |
| `archived` | `{ agentId: string }` | Agent was archived |
| `restored` | `AgentMeta` | Agent was restored from archive |
| `claudeMdChanged` | `{ agentId: string }` | Agent's CLAUDE.md was updated |
| `configChanged` | `{ agentId: string, config: Partial<AgentModelConfig> }` | Agent's model config changed |

### ChatAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `start` | `{ agentId: string, columnId?: string }` | Chat started |
| `chunk` | `{ agentId: string, columnId?: string, chunk: string }` | Text chunk received (thinking/text) |
| `toolCall` | `{ agentId: string, columnId?: string, toolName: string, args: unknown }` | Tool call initiated |
| `toolResult` | `{ agentId: string, columnId?: string, toolName: string, result: unknown }` | Tool call completed |
| `stepComplete` | `{ agentId: string, columnId?: string, step: number }` | Agent loop step completed |
| `done` | `{ agentId: string, columnId?: string, result: string }` | Chat finished |
| `error` | `{ agentId: string, columnId?: string, error: string }` | Error occurred |
| `aborted` | `{ agentId: string, columnId?: string }` | Chat was aborted |

### HooksAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `created` | `Hook` | Hook was created |
| `updated` | `Hook` | Hook was updated |
| `removed` | `{ hookId: string }` | Hook was removed |
| `enabled` | `{ hookId: string }` | Hook was enabled |
| `disabled` | `{ hookId: string }` | Hook was disabled |
| `triggered` | `{ hookId: string, agentId: string, context?: Record<string, unknown> }` | Hook was triggered |

### ChannelsAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `registered` | `ChannelConfig` | Channel was registered |
| `updated` | `ChannelConfig` | Channel was updated |
| `removed` | `{ channelId: string }` | Channel was removed |

### ArtifactsAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `deleted` | `{ agentId: string, artifactId: string }` | Artifact was deleted |

### FilesAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `written` | `{ agentId: string, path: string }` | File was written or appended |
| `deleted` | `{ agentId: string, path: string }` | File was deleted |

### SkillsAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `installed` | `{ agentId: string, skill: SkillMeta }` | Skill was installed |
| `removed` | `{ agentId: string, skillId: string }` | Skill was removed |

### TasksAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `created` | `Task` | Task was created |
| `cancelled` | `{ taskId: string }` | Task was cancelled |

### UsageAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `recorded` | `UsageRecord` | Usage record was added |

### SettingsAPI Events

| Event | Detail Type | Fired When |
|-------|-------------|------------|
| `changed` | `{ key: string, value: unknown }` | A setting was changed |
| `providerChanged` | `{ provider: string }` | Active provider was changed |

## Common Patterns

### Building a Reactive UI

```typescript
// Track all chat activity
sdk.chat.addEventListener('start', (e) => {
  const { agentId } = (e as CustomEvent).detail;
  showLoadingSpinner(agentId);
});

sdk.chat.addEventListener('chunk', (e) => {
  const { agentId, chunk } = (e as CustomEvent).detail;
  appendToChat(agentId, chunk);
});

sdk.chat.addEventListener('done', (e) => {
  const { agentId } = (e as CustomEvent).detail;
  hideLoadingSpinner(agentId);
});

sdk.chat.addEventListener('error', (e) => {
  const { agentId, error } = (e as CustomEvent).detail;
  showError(agentId, error);
});
```

### Logging All Activity

```typescript
const apis = [sdk.agents, sdk.chat, sdk.hooks, sdk.files, sdk.usage, sdk.settings];

for (const api of apis) {
  const original = api.dispatchEvent.bind(api);
  api.dispatchEvent = (event: Event) => {
    console.log(`[${api.constructor.name}] ${event.type}`, (event as CustomEvent).detail);
    return original(event);
  };
}
```

### Syncing State Across Components

```typescript
// Component A: settings panel
sdk.settings.addEventListener('providerChanged', (e) => {
  const { provider } = (e as CustomEvent).detail;
  updateProviderDropdown(provider);
});

// Component B: usage dashboard
sdk.usage.addEventListener('recorded', (e) => {
  const record = (e as CustomEvent).detail;
  updateUsageChart(record);
});

// Component C: agent list
sdk.agents.addEventListener('created', () => refreshAgentList());
sdk.agents.addEventListener('deleted', () => refreshAgentList());
sdk.agents.addEventListener('updated', () => refreshAgentList());
```
