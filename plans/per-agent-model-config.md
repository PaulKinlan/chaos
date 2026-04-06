# Plan: Per-Agent Model & Provider Configuration

## Status

All phases: TODO. Currently all agents share a single global provider/model setting.

---

## Problem

All agents share one global `activeProvider` and `model` setting. This means:
- Every agent uses the same LLM (e.g. Claude Sonnet 4.6)
- Can't optimise cost: a simple triage agent uses the same expensive model as the master
- Can't mix providers: if you want one agent on Gemini and another on Claude, you can't
- Can't use different API keys per agent (e.g. personal key vs team key)

## Current Architecture

```
Global Settings (chrome.storage.sync)
├── activeProvider: 'anthropic'
├── model: 'claude-sonnet-4-6'
└── theme: 'system'

API Keys (chrome.storage.local)
├── anthropic: 'sk-ant-...'
├── google: 'AI...'
├── openai: 'sk-...'
└── openrouter: 'sk-or-...'

Agentic Loop
└── getSettings() → { activeProvider, model }
└── getApiKeys() → { anthropic, google, ... }
└── createLanguageModel(activeProvider, apiKey, model)
    // Same for EVERY agent
```

## Proposed Architecture

```
Global Settings (unchanged — serves as default)
├── activeProvider: 'anthropic'  ← default for new agents
├── model: 'claude-sonnet-4-6'  ← default for new agents
└── theme: 'system'

API Keys (unchanged — shared pool)
├── anthropic: 'sk-ant-...'
├── google: 'AI...'
├── openai: 'sk-...'
└── openrouter: 'sk-or-...'

AgentMeta (NEW fields)
├── ...existing fields...
├── provider?: string        ← override global, e.g. 'google'
├── model?: string           ← override global, e.g. 'gemini-2.5-flash'
└── apiKeyOverride?: string  ← optional per-agent API key (stored in local, not sync)

Agentic Loop (updated)
└── getAgentModelConfig(agentId) → { provider, model, apiKey }
    ├── Check agent's provider/model overrides
    ├── Fall back to global settings if not set
    └── Check agent's apiKeyOverride, fall back to global API keys
```

## Key Design Decisions

### 1. API Keys: Shared Pool vs Per-Agent

**Recommended: Shared pool with optional per-agent override.**

Most users will configure API keys once in global settings. All agents use from that pool. But for advanced cases (team key vs personal key, different billing), an agent can have its own key.

Per-agent API keys should be stored in `chrome.storage.local` under a namespaced key like `chaos:agentApiKey:{agentId}` — never in sync storage (keys shouldn't sync across devices).

### 2. AgentMeta Changes

Only ADD optional fields (per CLAUDE.md migration rules):

```typescript
export interface AgentMeta {
  // ...existing fields...
  provider?: 'anthropic' | 'openai' | 'google' | 'openrouter';
  model?: string;      // e.g. 'gemini-2.5-flash', 'claude-haiku-4-5'
  apiKeyId?: string;   // reference to a named API key, or 'default'
}
```

### 3. Resolution Order

When the agentic loop needs a model:

```
1. agent.provider → use this provider
   OR fall back to settings.activeProvider

2. agent.model → use this model
   OR fall back to settings.model
   OR fall back to provider's default model

3. agent.apiKeyId → look up named key
   OR fall back to apiKeys[resolvedProvider]
```

### 4. UI Changes

**Agent Settings page** — add a "Model" section (collapsible):

```
┌─ Model Configuration ──────────────────────┐
│                                             │
│ Provider: [Use Global Default ▼]            │
│           Anthropic                         │
│           Google (Gemini)                   │
│           OpenAI                            │
│           OpenRouter                        │
│                                             │
│ Model:    [Provider Default ▼]              │
│           (populated based on provider)     │
│           Custom: [____________]            │
│                                             │
│ API Key:  [Use Global ▼]                    │
│           Custom: [••••••••••••]            │
│                                             │
│ [Save]                                      │
└─────────────────────────────────────────────┘
```

**Chat column headers** could show a small provider icon to indicate which model the agent is using.

**Master template** — when delegating, the master could consider which agents have which models and assign accordingly (e.g. "this needs vision, use the agent with Gemini").

## Implementation Phases

### Phase 1: AgentMeta + Resolution Logic

1. Add optional `provider` and `model` fields to `AgentMeta` interface
2. Create `getAgentModelConfig(agentId)` function:
   ```typescript
   async function getAgentModelConfig(agentId: string): Promise<{
     provider: ProviderId;
     model: string;
     apiKey: string;
   }> {
     const agent = await getAgent(agentId);
     const settings = await getSettings();
     const apiKeys = await getApiKeys();

     const provider = agent.meta.provider || settings.activeProvider;
     const model = agent.meta.model || settings.model;
     const apiKey = apiKeys[provider];

     if (!apiKey) throw new Error(`No API key for ${provider}`);

     return { provider, model: model || getDefaultModel(provider), apiKey };
   }
   ```
3. Update `runAgenticLoop` in agentic-loop.ts to use `getAgentModelConfig(agentId)` instead of reading global settings directly
4. Update `runAgentLoop` in loop.ts similarly
5. Test: agents without overrides continue using global settings (backwards compat)

### Phase 2: Agent Settings UI

1. Add "Model Configuration" section to agent settings in app.ts
2. Provider dropdown: "Use Global Default" + all available providers
3. Model dropdown: populated based on selected provider (reuse `getFallbackModels`)
4. Custom model text input for unlisted models
5. Save button updates AgentMeta via `updateAgentMeta`
6. Show current effective model in the section header: "Currently using: Claude Sonnet 4.6 (global)"

### Phase 3: Per-Agent API Keys (Optional)

1. Add "API Key" option in agent model config: "Use Global" or "Custom"
2. Custom key stored in `chrome.storage.local` under `chaos:agentApiKey:{agentId}`
3. Resolution logic checks per-agent key first
4. Never display or log the actual key value

### Phase 4: Visual Indicators

1. Chat column headers show provider icon/badge when agent has a custom model
2. Agent list in sidebar shows model info on hover
3. Master agent's delegation logic mentions available models in context

## Migration

This is a safe additive change:
- New fields are optional on AgentMeta
- Agents without `provider`/`model` fields continue using global settings
- No data migration needed
- getAgentList() already handles missing fields gracefully

## Already Implemented (Foundation)

- [x] Ollama provider added to provider-registry.ts (OpenAI-compatible, default http://localhost:11434/v1)
- [x] All providers accept optional baseURL parameter (for Vertex AI, Azure, self-hosted)
- [x] Ollama in global settings UI with base URL field
- [x] ProviderId type includes 'ollama'
- [x] ApiKeys type includes 'ollama' (stores base URL, not a key)
- [x] createLanguageModel accepts baseURL parameter

## Open Questions

1. **Should the master know about other agents' models?** When delegating, it could be useful to know "Agent X uses Gemini with vision, Agent Y uses Claude for coding". The `find_agent` and `agent_discover` tools could include model info.

2. **Cost tracking per agent?** With different models, users might want to see token usage per agent. Not in scope for this plan but worth considering.

3. **Model-specific features?** Some models support vision, some don't. Some have larger context windows. Should we surface these capabilities so the master can make informed delegation decisions?

4. **OpenRouter as a meta-provider?** Users could set one agent to `openrouter` with model `anthropic/claude-sonnet-4-6` and another to `openrouter` with `google/gemini-2.5-flash` — all using the same API key but different models. This already works with the current architecture.
