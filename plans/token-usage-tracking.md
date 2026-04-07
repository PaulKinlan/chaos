# Plan: Token Usage Tracking & Cost Estimation

## Status

- Phase 1 (Core Tracking): DONE
- Phase 2 (Global Usage View): DONE
- Phase 3 (Per-Agent Usage): DONE
- Phase 4 (Alerts & Limits): DONE

---

## Problem

Users have no visibility into how much their agents cost. With per-agent model config, different agents use different providers at different price points. Without tracking:
- No way to know which agent is expensive
- No way to budget or set limits
- No way to compare cost of different model configurations
- Multi-agent delegation can run up costs silently

## Goals

1. Track token usage per request (input + output tokens)
2. Estimate cost based on provider pricing
3. Show usage broken down by: global total, per-provider, per-agent
4. Persist usage data across sessions
5. Optional: spending alerts/limits

## Architecture

```
Agentic Loop / Agent Loop
  └── LLM call returns usage metadata
      └── Record: { agentId, provider, model, inputTokens, outputTokens, timestamp }
          └── Store in chrome.storage.local (rolling window)
              └── UI reads and displays aggregated stats

Views:
  ┌─────────────────────────────────┐
  │ Global Usage Dashboard          │
  │                                 │
  │ Total: $12.34 (24hr)           │
  │ ┌───────────────────────────┐   │
  │ │ By Provider               │   │
  │ │ Anthropic: $8.20 (67%)    │   │
  │ │ Google:    $3.14 (25%)    │   │
  │ │ Ollama:    $0.00 (0%)     │   │
  │ │ OpenAI:    $1.00 (8%)     │   │
  │ └───────────────────────────┘   │
  │ ┌───────────────────────────┐   │
  │ │ By Agent                  │   │
  │ │ ★ Assistant: $6.50       │   │
  │ │   Web Designer: $3.84    │   │
  │ │   Researcher: $2.00      │   │
  │ └───────────────────────────┘   │
  │ ┌───────────────────────────┐   │
  │ │ Recent Requests           │   │
  │ │ 14:03 Assistant 1.2k/0.8k│   │
  │ │ 14:01 Designer  2.1k/1.5k│   │
  │ │ 13:58 Assistant 0.5k/0.3k│   │
  │ └───────────────────────────┘   │
  └─────────────────────────────────┘
```

## Data Model

### Usage Record

```typescript
interface UsageRecord {
  id: string;
  timestamp: string;          // ISO 8601
  agentId: string;
  agentName: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;      // USD, calculated from pricing table
  source: 'chat' | 'hook' | 'channel' | 'task' | 'message'; // what triggered the call
}
```

### Storage

Store in `chrome.storage.local` under `chaos:usage`:
- Rolling array of UsageRecords
- Keep last 7 days (or configurable retention)
- Trim on write to prevent unbounded growth
- Max ~5000 records (enough for heavy usage)

### Pricing Table

```typescript
const PRICING: Record<string, { input: number; output: number }> = {
  // Price per 1M tokens in USD
  'claude-sonnet-4-6':     { input: 3.00,  output: 15.00 },
  'claude-opus-4-6':       { input: 15.00, output: 75.00 },
  'claude-haiku-4-5':      { input: 0.80,  output: 4.00 },
  'gemini-2.5-flash':      { input: 0.15,  output: 0.60 },
  'gemini-2.5-pro':        { input: 1.25,  output: 5.00 },
  'gpt-5.4':               { input: 2.50,  output: 10.00 },
  'gpt-5.4-mini':          { input: 0.40,  output: 1.60 },
  // Ollama is free (local)
  'llama3.2':              { input: 0, output: 0 },
  'mistral':               { input: 0, output: 0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = PRICING[model] || { input: 1.0, output: 3.0 }; // default estimate
  return (inputTokens / 1_000_000) * prices.input +
         (outputTokens / 1_000_000) * prices.output;
}
```

Pricing will drift over time — keep it in a separate file (`src/agents/pricing.ts`) so it's easy to update.

## Capturing Usage

### Vercel AI SDK Usage

The AI SDK returns usage in the response:

```typescript
const result = await streamText({ ... });
// After streaming completes:
const usage = await result.usage;
// usage = { promptTokens: number, completionTokens: number, totalTokens: number }
```

For `generateText`:
```typescript
const result = await generateText({ ... });
result.usage; // { promptTokens, completionTokens, totalTokens }
```

### Integration Points

Capture usage after every LLM call in:
1. `agentic-loop.ts` — after `streamText` completes each step
2. `loop.ts` — after `streamText` completes
3. `background.ts` — refinePrompt (uses `generateText`)

```typescript
// After streamText completes:
const usage = await result.usage;
if (usage) {
  await recordUsage({
    agentId,
    provider: modelConfig.provider,
    model: modelConfig.model,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    source: 'chat', // or 'hook', 'channel', 'task', 'message'
  });
}
```

### Per-Step vs Per-Loop Tracking

The agentic loop runs multiple steps (iterations). Track per-step so users can see:
- Total tokens for the whole task
- Breakdown per step (step 1 used 2k tokens, step 2 used 5k for a tool-heavy operation)

## Implementation Phases

### Phase 1: Core Tracking

1. Create `src/agents/usage.ts`:
   - `recordUsage(record)` — stores to chrome.storage.local
   - `getUsage(options)` — read with filters (timeRange, agentId, provider)
   - `clearUsage()` — wipe history
   - `getUsageSummary()` — aggregate stats
2. Create `src/agents/pricing.ts` — pricing table + estimateCost function
3. Integrate into `agentic-loop.ts` and `loop.ts` after streamText
4. Log usage to console for debugging

### Phase 2: Global Usage View

1. Add "Usage" to global settings (or as a sidebar item)
2. Show: total cost (24hr, 7d, 30d, all-time), by provider, by agent
3. Recent requests table (timestamp, agent, tokens in/out, cost)
4. Simple bar chart or proportional display for provider/agent breakdown

### Phase 3: Per-Agent Usage

1. Add "Usage" section to agent settings
2. Show: total cost, average per interaction, most expensive request
3. Model comparison: "This agent would cost X with Gemini Flash vs Y with Claude Opus"
4. Accessible from the agent's sidebar sub-items

### Phase 4: Alerts & Limits (Optional)

1. Set spending alerts: "Notify me when daily spending exceeds $X"
2. Per-agent limits: "This agent can spend max $Y per day"
3. Pause agent when limit hit (require user confirmation to continue)
4. Desktop notification when alert threshold reached

## UI Placement

Options for where the usage dashboard lives:

**Option A: Global Settings section** — alongside Providers, Appearance, Permissions
- Pro: keeps settings together
- Con: hidden behind the cog

**Option B: Sidebar item** — between Channels and Hooks
- Pro: always accessible, first-class view
- Con: adds another sidebar item

**Option C: Both** — summary in settings, detailed view in sidebar
- Pro: overview in settings, deep dive in sidebar
- Con: two places to maintain

**Recommendation: Option B** — usage is important enough for its own sidebar item, especially with multi-agent cost implications.

## Open Questions

1. **Pricing accuracy**: Prices change. Should we fetch latest pricing from an API, or keep a static table? Static is simpler and works offline.

2. **Multi-step token counting**: streamText with tools does multiple LLM calls per step. The usage returned by the SDK should aggregate these, but verify.

3. **Caching input tokens**: Some providers (Anthropic) cache input tokens at lower cost. Should we track cached vs non-cached?

4. **OpenRouter pricing**: OpenRouter has its own pricing layer. Track at OpenRouter's rate or the underlying model's rate?

5. **Export**: Should users be able to export usage data as CSV/JSON for expense reporting?

6. **Privacy**: Usage data includes agent names and model info. Should it be excluded from sync storage? (Already planned for chrome.storage.local only.)
