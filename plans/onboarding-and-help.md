# Plan: Onboarding Experience & Integrated Help System

## Status

All phases: TODO.

---

## Problem

New users install the extension and see an empty dashboard with no guidance. They need to:
1. Add API keys before anything works
2. Understand the agent model (master agent, sub-agents, delegation)
3. Know what channels, hooks, skills, and jobs are
4. Find help when stuck

Currently there's no onboarding, no in-app help, and documentation lives in separate markdown files that users won't find.

## Goals

1. **First-run onboarding** — guide new users through initial setup
2. **Contextual help** — every view has a ? button with relevant help
3. **Self-updating help** — help content derived from docs so it stays current
4. **Progressive disclosure** — don't overwhelm, reveal features as needed

## Part 1: First-Run Onboarding

### Detection

On first load, check if any API keys are configured:
```typescript
const keys = await getApiKeys();
const hasAnyKey = Object.values(keys).some(k => k && k.length > 0);
if (!hasAnyKey) {
  showOnboarding();
}
```

### Onboarding Flow (Wizard)

A multi-step dialog overlay:

#### Step 1: Welcome
```
┌─────────────────────────────────────────────┐
│                                             │
│  Welcome to CHAOS                           │
│  Chrome Agent OS                            │
│                                             │
│  AI agents that live in your browser,       │
│  learn about you, and act on your behalf.   │
│                                             │
│  Let's get you set up in 2 minutes.         │
│                                             │
│                          [Get Started →]    │
└─────────────────────────────────────────────┘
```

#### Step 2: Choose Provider & API Key
```
┌─────────────────────────────────────────────┐
│                                             │
│  Choose your AI provider                    │
│                                             │
│  ○ Anthropic (Claude)     [recommended]     │
│  ○ Google (Gemini)                          │
│  ○ OpenAI                                   │
│  ○ OpenRouter (multiple providers)          │
│  ○ Ollama (local, free)                     │
│                                             │
│  API Key: [________________________]        │
│                                             │
│  Don't have a key? [Get one →]              │
│                                             │
│  [← Back]                  [Continue →]     │
└─────────────────────────────────────────────┘
```

Links for each provider:
- Anthropic: https://console.anthropic.com/settings/keys
- Google: https://aistudio.google.com/app/apikey
- OpenAI: https://platform.openai.com/api-keys
- OpenRouter: https://openrouter.ai/keys
- Ollama: "Install Ollama from ollama.ai — no key needed"

#### Step 3: Chat with Your Agent

Close the wizard and open a chat column with the master agent. The agent automatically sends an introductory message:

> "Hi! I'm your CHAOS assistant. I live in your browser and can help you with all sorts of things. Ask me what I can do, or try one of these:
> - "Read this page and summarize it"
> - "What tabs do I have open?"
> - "Set up a Telegram channel"
>
> What would you like to do?"

This is a real conversation — the user can immediately start interacting. The agent's CLAUDE.md already describes its capabilities, so it can answer "what can you do?" naturally.

Implementation: after the wizard completes, call `sendPortMessage({ type: 'agenticChat', agentId: masterAgentId, message: 'Introduce yourself to a new user. Explain what you can do in a friendly, concise way. Suggest 3 things they could try right now.' })` to trigger the agent's first message.

### Implementation

- `src/ui/onboarding.ts` — onboarding wizard logic
- Rendered as a `<dialog>` overlay (consistent with existing patterns)
- State stored in `chrome.storage.local`: `chaos:onboarding-completed: true`
- Can be re-triggered from Settings: "Re-run setup wizard"
- Wizard validates API key before proceeding (test call to provider)

## Part 2: Integrated Help System

### Help Button (?) in Every View

Each view gets a small ? icon button in the top-right of the section header. Clicking it opens a help panel relevant to that view.

```
┌─ Chat ──────────────────────────── [?] ─┐
│                                          │
│  (normal chat content)                   │
│                                          │
└──────────────────────────────────────────┘
```

### Help Panel

When ? is clicked, a slide-in panel appears on the right (or a dialog):

```
┌─ Help: Chat ──────────────── [×] ─┐
│                                    │
│  ## Chat                           │
│                                    │
│  Talk to your agents here. Each    │
│  column is a separate conversation.│
│                                    │
│  ### Tips                          │
│  • Use @agent to mention agents    │
│  • Click "Delegate" to hand off    │
│  • Read page button grabs content  │
│                                    │
│  ### Keyboard Shortcuts            │
│  Ctrl+Shift+C — Open CHAOS        │
│  Ctrl+Shift+U — Voice input       │
│  Enter — Send message              │
│  Shift+Enter — New line            │
│                                    │
│  [Ask the agent for help →]        │
│                                    │
│  ─────────────────────────         │
│  Last updated: 2026-04-06          │
└────────────────────────────────────┘
```

### Help Content Per View

| View | Help Topics |
|------|-------------|
| **Chat** | Columns, @mentions, delegate button, page context, voice input, keyboard shortcuts |
| **Jobs** | What jobs are, how delegation works, timeline view, creating/deleting jobs |
| **Artifacts** | What artifacts are, how agents publish them, viewing/copying/deleting |
| **Channels** | Relay server, Telegram/Discord/Email setup, webhooks, pairing flow, allowlists |
| **Hooks** | What hooks are vs channels, trigger types, prompt writing, refine button |
| **Agent Memory** | File browser, what's stored, how agents learn |
| **Agent Messages** | Sent/received, inter-agent communication, how delegation messages work |
| **Agent Tasks** | Scheduled tasks, run history, creating tasks |
| **Agent Settings** | Visibility, tools, skills, CLAUDE.md, model config, danger zone |
| **Global Settings** | Providers, API keys, theme, permissions, archived agents |

### "Ask the Agent" Fallback

At the bottom of every help panel: "Ask the agent for help →" button. Clicking it:
1. Opens the chat view
2. Pre-fills the input with: "I need help with [current view name]"
3. The agent uses its knowledge + the help docs to assist

### Help Content Source

Help content lives in `docs/help/` as markdown files:
```
docs/help/
  chat.md
  jobs.md
  artifacts.md
  channels.md
  hooks.md
  memory.md
  messages.md
  tasks.md
  agent-settings.md
  global-settings.md
```

These are loaded at build time (Vite raw import) or fetched from the extension's bundled assets. This means:
- Help is always bundled with the extension version
- When features change, the help files are updated in the same PR
- No external fetching needed

### Keeping Help Updated

Add to CLAUDE.md:
```
## Help documentation (MANDATORY)

When adding or changing user-facing features, update the corresponding
help file in docs/help/. If adding a new view, create a new help file.

Help files use markdown. Keep them concise — users scan, not read.
Use ### for sections, bullet points for tips, `code` for shortcuts.
```

## Part 3: Empty State Guidance

Every view that can be empty should have helpful guidance instead of just "No items":

| View | Current Empty State | Improved Empty State |
|------|-------------------|---------------------|
| Jobs | "No jobs yet" | "Jobs are work items posted to a shared board. Try asking your agent to delegate a task." + [Learn more] |
| Artifacts | "No artifacts" | "Artifacts are files agents create and share. Ask an agent to research something or build a page." + [Learn more] |
| Channels | "No channels" | "Connect external services like Telegram, Discord, or Email. Your agent can receive and send messages." + [Set up a channel] |
| Hooks | "No hooks" | "Hooks trigger your agent automatically when browser events happen — bookmarks, downloads, tab changes." + [Create a hook] |
| Messages | "No messages" | "Messages appear when agents communicate with each other during task delegation." |

## Implementation Phases

### Phase 1: First-Run Onboarding Wizard
1. Create `src/ui/onboarding.ts` with multi-step dialog
2. Detect first run (no API keys)
3. Provider selection + key input + validation
4. Welcome screen + quick summary
5. Store completion state
6. "Re-run wizard" button in global settings

### Phase 2: Help Content Files
1. Create `docs/help/*.md` for all 10 views
2. Bundle them into the extension build (Vite raw import or copy)
3. Add CLAUDE.md directive about updating help

### Phase 3: Help Button UI
1. Add ? button to every view's section header
2. Help panel component (slide-in or dialog)
3. Load and render markdown content
4. "Ask the agent" fallback button

### Phase 4: Improved Empty States
1. Update all empty state messages with guidance and action buttons
2. Link empty states to help content

### Phase 5: Contextual Tooltips
1. First-time tooltips for key UI elements (sidebar items, delegate button, etc.)
2. "Don't show again" option
3. Stored in chrome.storage.local

## Open Questions

1. **Video/GIF guidance?** Short animated demonstrations might help more than text for complex flows like Telegram pairing. But they increase bundle size.

2. **Interactive tutorial?** Step-by-step guided actions (like "click here, then type this") vs. passive documentation. More engaging but harder to maintain.

3. **Help search?** Should the help panel have a search box? Or is "ask the agent" sufficient?

4. **Localisation?** Help content in English only for now, but the markdown structure makes future localisation possible.

5. **Version-specific help?** Should help content mention what's new in this version? A "What's New" section on update could complement the onboarding.
