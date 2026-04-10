# CHAOS Services

## messaging.ts

Provides `sendMsg` and `sendPortMessage` singletons that components use to communicate with the Chrome extension background service worker.

### Architecture

```
Component (Lit)
    |
    | sendMsg({ type: 'getArtifacts' })
    v
messaging.ts singleton
    |
    | chrome.runtime.sendMessage (request-response)
    | or chrome.runtime.port.postMessage (fire-and-forget)
    v
background.ts (service worker)
```

### Initialization

`app.ts` initializes the messaging layer at startup after establishing the Chrome runtime port:

```typescript
import { setSendMsg, setSendPortMessage } from './services/messaging.js';

// After port connection:
setSendMsg(myRequestResponseFn);
setSendPortMessage(myPortPostMessageFn);
```

Until initialization, calling `sendMsg` or `sendPortMessage` throws an error. This ensures components cannot make background calls before the port is ready.

### API

#### `sendMsg<T>(msg: Record<string, unknown>): Promise<T>`

Async request-response messaging. Used for data fetching operations.

```typescript
import { sendMsg } from '../../services/messaging.js';

// Fetch artifacts
const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });

// Fetch usage data
const usage = await sendMsg<{ summary: UsageSummary }>({
  type: 'getUsageSummary',
  since: '2024-01-01T00:00:00Z',
});

// Mutate data
await sendMsg({ type: 'deleteArtifact', artifactPath: 'some/path.json' });
```

The `type` field determines which handler runs in the background. The generic type parameter `T` types the response.

#### `sendPortMessage(msg: Record<string, unknown>): void`

Fire-and-forget messaging via the long-lived Chrome runtime port. Used for streaming operations and commands that don't need a direct response.

```typescript
import { sendPortMessage } from '../../services/messaging.js';

// Start an agentic chat (response comes back via port message events)
sendPortMessage({
  type: 'agenticChat',
  agentId: 'agent-123',
  columnId: 'col-1',
  message: 'Hello',
});

// Request hooks list (response comes via port onMessage handler in app.ts)
sendPortMessage({ type: 'getHooks' });
```

Responses to port messages are handled by `app.ts`'s port message listener, which routes them to the appropriate view component (e.g., calling `setHooks()` on the hooks view).

### Usage from Components

Components import `sendMsg` and `sendPortMessage` directly:

```typescript
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
```

There is no dependency injection or context -- the functions are module-level singletons. This keeps component code simple at the cost of making unit testing harder (would need to mock the module).

### Common Message Types

**Via `sendMsg` (request-response):**
- `getArtifacts` -- list all artifacts
- `readArtifactContent` -- read file content
- `getMessages` -- list inter-agent messages
- `getTaskState` -- list collaborative tasks
- `getScheduledTasks` -- list scheduled/recurring tasks
- `getTaskEvents` -- task timeline events
- `getUsageSummary` -- usage statistics
- `getUsageRecords` -- detailed usage records
- `getApiKeys` -- retrieve API key configuration
- `getSettings` -- global settings
- `getAgentMeta` -- single agent metadata
- `listAgentFiles` -- agent memory file listing
- `readAgentFile` -- read a file from agent memory
- `getSpendingLimit` -- spending alert threshold

**Via `sendPortMessage` (fire-and-forget):**
- `agenticChat` -- start a streaming chat
- `getHooks` -- request hooks list (response via port)
- `addHook` / `updateHook` / `removeHook` -- hook CRUD
