# Plan: Smart Onboarding — Context-Aware First Run Experience

## Status

All phases: TODO.

---

## Problem

After the onboarding wizard (pick a provider, enable permissions), the user lands on a blank chat column with no idea what to do. The agent has zero context about the user. The first interaction is the hardest — the user has to think of something to say to an AI they've never met.

## Goals

1. Eliminate the blank-slate problem — the agent should have something useful to say from the first moment
2. Use permissions the user just granted to bootstrap context (history, bookmarks, tabs)
3. Offer clickable suggested actions — not just "how can I help you?" but specific, contextual prompts based on what the user has actually been doing
4. Suggest hooks that match the user's browsing patterns
5. Make the first 30 seconds feel like the agent already knows you

## Architecture

```
Onboarding Wizard
  Step 1: Choose provider + API key
  Step 2: Enable permissions
  Step 3: Smart Start (NEW)
    │
    ├── Gather context (based on granted permissions)
    │   ├── History: last 48h of browsing
    │   ├── Bookmarks: recent bookmarks
    │   ├── Tabs: currently open tabs
    │   └── Reading list: queued articles
    │
    ├── Analyze context (one LLM call)
    │   ├── Identify themes (shopping, research, travel, work, etc.)
    │   ├── Generate 3-5 suggested actions
    │   └── Generate 2-3 suggested hooks
    │
    └── Present Smart Start UI
        ├── "Here's what I noticed..." summary
        ├── Clickable action cards
        └── Suggested hooks with one-click install
```

## Phases

### Phase 1: Context Gathering

After permissions are granted, gather available context before showing the final onboarding step.

**Data sources (permission-dependent):**

| Permission | Data | API |
|---|---|---|
| `history` | Last 48h of visited URLs | `chrome.history.search({ text: '', startTime, maxResults: 200 })` |
| `bookmarks` | Recent bookmarks (last 20) | `chrome.bookmarks.getRecent(20)` |
| `tabs` | Currently open tabs | `chrome.tabs.query({})` |
| `readingList` | Queued articles | `chrome.readingList.query({})` |
| (none needed) | Extension install time | `chrome.runtime.getManifest().version` |

**Privacy considerations:**
- All processing happens locally (sent to the user's chosen LLM provider, same as any chat)
- Raw URLs/titles are not stored — only the LLM's summarized themes
- User can skip Smart Start entirely
- Show a brief privacy note: "This stays between you and your AI provider"

**Output:** A `BrowsingContext` object:

```typescript
interface BrowsingContext {
  historyUrls: Array<{ url: string; title: string; visitTime: number }>;
  bookmarks: Array<{ url: string; title: string; dateAdded: number }>;
  openTabs: Array<{ url: string; title: string }>;
  readingList: Array<{ url: string; title: string }>;
  permissions: string[]; // which permissions were granted
}
```

### Phase 2: Context Analysis

One LLM call to analyze the browsing context and generate actionable suggestions.

**Prompt structure:**

```
You are helping a new user get started with an AI browser assistant.
Based on their recent browsing activity, suggest specific things the
assistant could help with RIGHT NOW.

Recent browsing history (last 48h):
[URLs and titles]

Currently open tabs:
[URLs and titles]

Recent bookmarks:
[URLs and titles]

Generate:
1. A brief, friendly summary of what you notice (2-3 sentences)
2. 3-5 specific action cards the user can click to start a conversation
3. 2-3 suggested browser hooks that would be useful based on their patterns

Format each action as:
- title: Short action title (e.g. "Compare flight prices")
- description: What the assistant will do
- prompt: The exact prompt to send to the assistant

Format each hook suggestion as:
- description: What the hook does
- trigger: The hook trigger type
- prompt: The hook prompt
- reason: Why this hook would be useful for this user
```

**Output:** `SmartStartSuggestions`:

```typescript
interface SmartStartSuggestions {
  summary: string;
  actions: Array<{
    title: string;
    description: string;
    prompt: string;
    icon?: string; // category hint for icon selection
  }>;
  hookSuggestions: Array<{
    description: string;
    trigger: HookTrigger;
    prompt: string;
    reason: string;
  }>;
}
```

### Phase 3: Smart Start UI

Replace the current blank-slate chat with a contextual welcome screen.

**Layout:**

```
┌─────────────────────────────────────────┐
│  👋 Welcome to CHAOS                    │
│                                         │
│  "I noticed you've been researching     │
│   holidays to Japan and comparing       │
│   camera gear. Here are some things     │
│   I can help with right now:"           │
│                                         │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Compare  │ │ Summarize│ │ Create a│ │
│  │ flights  │ │ camera   │ │ packing │ │
│  │ to Tokyo │ │ reviews  │ │ list    │ │
│  │          │ │ you've   │ │ for     │ │
│  │ Click to │ │ bookmar- │ │ Japan   │ │
│  │ start    │ │ ked      │ │ trip    │ │
│  └──────────┘ └──────────┘ └─────────┘ │
│                                         │
│  ┌──────────┐ ┌──────────┐             │
│  │ Track    │ │ Daily    │             │
│  │ prices   │ │ digest   │             │
│  │ on these │ │ of news  │             │
│  │ products │ │ sites    │             │
│  └──────────┘ └──────────┘             │
│                                         │
│  Suggested Hooks:                       │
│  ┌─────────────────────────────────────┐│
│  │ 📌 Auto-summarize bookmarked pages  ││
│  │ "You bookmark a lot — want me to    ││
│  │  auto-summarize each one?"          ││
│  │                    [Enable] [Skip]  ││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ 🔔 Price drop alerts               ││
│  │ "I'll watch those camera product    ││
│  │  pages and notify you of drops"     ││
│  │                    [Enable] [Skip]  ││
│  └─────────────────────────────────────┘│
│                                         │
│  ─── or just start chatting below ───   │
│  [____________________________________] │
└─────────────────────────────────────────┘
```

**Interaction:**
- Clicking an action card sends the prompt to the agent and transitions to normal chat
- Clicking "Enable" on a hook suggestion creates the hook immediately
- Clicking "Skip" dismisses that suggestion
- The chat input is always available at the bottom — user can ignore suggestions entirely
- Smart Start only shows once (flag in chrome.storage.local)
- "Show Smart Start again" option in Settings for re-running

### Phase 4: Fallback — No Permissions

If the user didn't grant history/bookmarks permissions, Smart Start should still work:

**Fallback data sources:**
- Open tabs (always available via `activeTab`)
- The current page content (if they came from somewhere)
- Time of day (morning → "plan your day", evening → "summarize what you did")
- Day of week (Monday → "plan the week", Friday → "wrap up")

**Minimal suggestions (no permissions):**
- "Read this page and summarize it"
- "What are the key takeaways from my open tabs?"
- "Help me organize my tabs into groups"
- "Set up a daily review hook"

### Phase 5: Progressive Profiling

After the first session, the agent should continue learning:

- After the first 3 conversations, analyze what topics came up and write to `memories/user.md`
- After the first hook triggers, note what worked and suggest refinements
- After a week, offer a "weekly review" that summarizes what the agent has learned

This phase is about the agent becoming proactively better over time, not just the first-run experience.

## Implementation Notes

### Where Smart Start lives

- The context gathering runs in `background.ts` (has access to Chrome APIs)
- The LLM analysis runs via the existing agent loop (or a direct `generateText` call)
- The UI renders in `app.ts` as a special state in the chat view (replaces the empty column content)
- After any action is clicked, Smart Start transitions to normal chat and doesn't show again

### New message types

```typescript
// background.ts handlers
case 'gatherBrowsingContext': → returns BrowsingContext
case 'analyzeForSmartStart': → runs LLM, returns SmartStartSuggestions
case 'installSuggestedHook': → creates hook from suggestion
```

### Storage

```typescript
// chrome.storage.local
'chaos:smart-start-completed': boolean  // don't show again
'chaos:smart-start-suggestions': SmartStartSuggestions  // cache for re-display
```

## Open Questions

1. **How much history is too much?** 200 URLs over 48h could be a lot of tokens. Should we deduplicate by domain? Group by topic before sending to the LLM?

2. **Should Smart Start re-run periodically?** E.g., "It's been a week — want me to check what's new?" Could be a weekly hook rather than a separate feature.

3. **What if the LLM call fails?** Fall back to the static suggestions (summarize page, organize tabs, set up hooks). Don't block onboarding on LLM availability.

4. **Should we show the raw data?** "I looked at your last 48h of history" could feel creepy. Better to show only the summarized themes, not the raw URLs. But a "see what I analyzed" toggle for transparency could help.

5. **Multiple agents?** Smart Start only applies to the master agent. Sub-agents created later don't need it — they get context from the master's delegation.
