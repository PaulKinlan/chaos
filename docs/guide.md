# CHAOS User Guide

## Installation

CHAOS is a Chrome extension loaded as an unpacked extension during development.

1. Clone the repository and install dependencies:
   ```
   git clone <repo-url>
   cd chaos
   npm install
   ```

2. Build the extension:
   ```
   cd packages/extension
   npx vite build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (toggle in top-right)
   - Click **Load unpacked**
   - Select the `packages/extension/dist` directory

4. The CHAOS icon appears in your Chrome toolbar. Click it to open the dashboard.

## First Setup

### Default Agent

On first install, CHAOS automatically creates a **master agent** named "Assistant" with the `master` role. This is your primary AI agent. It comes pre-configured with:
- A daily review alarm (runs every 24 hours)
- Visible to all other agents
- Access to all tools including agent management

### Configure an API Key

1. Click the CHAOS icon to open the dashboard
2. Click the **gear icon** in the top bar to open Global Settings
3. Under **API Keys**, enter your key for at least one provider:
   - **Anthropic** (recommended): Get a key at [console.anthropic.com](https://console.anthropic.com)
   - **Google**: Get a key at [aistudio.google.com](https://aistudio.google.com)
   - **OpenAI**: Get a key at [platform.openai.com](https://platform.openai.com)
   - **OpenRouter**: Get a key at [openrouter.ai](https://openrouter.ai) (access to multiple models)
   - **Brave Search** (optional): Enables web search via Brave API
4. Select your **Active Provider** and preferred model
5. Settings auto-save

### Grant Permissions

Some tools require optional Chrome permissions. CHAOS will prompt you when needed, or you can grant them proactively in Settings:
- **Browsing history**: Enables `history_search` tool
- **Reading list**: Enables `reading_list_add` and `reading_list_query` tools
- **Host permissions** (`<all_urls>`): Enables content extraction from any page and `fetch_page` tool

## Using the Dashboard

The dashboard uses a layout with:
- **Top bar**: Agent tabs (click to switch), `+` button to create agents, gear icon for settings
- **Left sidebar**: View navigation for the active agent
- **Main area**: The selected view

### Views

| View | Description |
|------|-------------|
| **Chat** | Conversation interface with the active agent. Supports multiple columns (TweetDeck-style). |
| **Tasks** | Shared task board showing all tasks across agents. Filter by agent, status. |
| **Messages** | Inter-agent message log. See communication between agents. |
| **Artifacts** | Published files shared between agents. |
| **Files** | Browse the agent's OPFS file system (memories, ideas, activity log, etc.). |
| **Agent Settings** | Configure the active agent (name, role, tools, hooks, scheduled tasks, skills). |
| **Global Settings** | API keys, provider selection, theme, relay server config. |

### Chat Interface

The chat uses a multi-column layout. Each column is an independent conversation thread:

- Type a message and press Enter (or click Send) to chat with the active agent
- The agent streams its response in real-time
- Tool calls appear inline showing what the agent did
- Click **New Column** to open a parallel conversation (useful for multi-tasking)
- Use the **page context** button to feed the current tab's content to the agent

#### Page Context

Click the page icon in the chat input area to extract and send the current tab's content to the agent. The agent receives the page title, URL, and markdown-formatted content. You can also right-click on any page and select **Send to CHAOS agent** from the context menu.

## Creating Agents

### Via the Dashboard

1. Click the `+` button in the agent tab bar
2. Enter a name and select a role:
   - **master** -- orchestrator, delegates to other agents
   - **neutral** -- general purpose
   - **researcher** -- web research and data gathering
   - **coder** -- programming and technical tasks
   - **writer** -- content creation and editing
   - **planner** -- project planning and task breakdown
   - **reviewer** -- code and content review
3. Click Create

### Via the Master Agent

The master agent can create sub-agents on its own when delegating tasks:

```
You: Research the latest developments in WebGPU and write a summary

Agent: I'll delegate this to a researcher. Let me check for existing agents first...
[Uses agent_discover, finds no researcher]
[Uses create_agent to spawn "WebGPU Researcher" with role "researcher"]
[Uses assign_task to give it the research prompt]
I've assigned this to WebGPU Researcher. They'll work on it and I'll report back.
```

### Agent Visibility

- **private**: Agent cannot communicate with other agents
- **visible**: Agent can send/receive messages and participate in task board
- **open**: Same as visible (future: may allow external access)

## Setting Up Channels

Channels connect external services to your agents via the relay server.

### Relay Server Configuration

1. Go to **Global Settings** > **Relay Server**
2. Enter the relay server URL (e.g., `https://chaos-relay.deno.dev`)
3. Click **Register** to create a session
4. The extension stores the API key and connects via WebSocket

### Webhooks

Webhooks let external services push messages to your agents:

1. Go to **Global Settings** > **Channels**
2. Click **Add Channel** > **Webhook**
3. Select which agent should receive messages
4. Copy the generated webhook URL (includes auth token)
5. Configure your external service to POST to that URL

Example webhook payload:
```json
{
  "content": "Deploy to production completed successfully",
  "from": "CI/CD Pipeline"
}
```

### Telegram

Pair a Telegram bot for bidirectional messaging:

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. Go to **Global Settings** > **Channels**
4. Click **Add Channel** > **Telegram**
5. Paste the bot token and select an agent
6. Note the **pairing code** displayed after registration
7. Open your bot in Telegram and send the pairing code as a message
8. Once paired, you can chat with your agent directly in Telegram

**Allowlist**: By default, only the paired owner can talk to the bot. Add more users in channel settings.

## Delegating Tasks

The master agent handles task delegation automatically, but you can guide it:

### Direct Delegation
```
You: Have the coder agent write a Python script that scrapes Hacker News

Agent: [Discovers existing coder agent]
[Assigns task with detailed prompt]
Done. I've assigned this to Coder. They'll message me when finished.
```

### Task Dependencies
```
You: First research competitor pricing, then write a comparison report

Agent: I'll break this into two tasks:
1. Research task (assigned to Researcher)
2. Writing task (assigned to Writer, blocked by research task)
When the research completes, the writing task will auto-trigger.
```

### Checking Status
```
You: What's the status of the research task?

Agent: [Uses get_agent_status to check the researcher]
The researcher has completed 3 web searches and is compiling findings...
```

## Hooks

Hooks are event-driven triggers that make agents react to browser events.

### Creating Hooks

Via chat:
```
You: Set up a hook so that whenever I bookmark a page, summarize it and save the summary

Agent: [Uses hook_create with trigger: bookmark-created]
Done. I've created a hook that triggers on new bookmarks. When you bookmark
a page, I'll read its content, write a summary, and save it to my notes.
```

Via Agent Settings:
1. Go to the agent's **Agent Settings** view
2. Scroll to **Hooks**
3. Click **Add Hook**
4. Select a trigger type and configure filters
5. Write the prompt (what the agent should do when triggered)

### Trigger Types

| Trigger | What fires it | Example use |
|---------|--------------|-------------|
| Bookmark created | You bookmark a page | Auto-summarize bookmarked articles |
| Tab navigated | A tab loads a matching URL | Track time on specific sites |
| Tab created/closed | Any tab opens/closes | Monitor browsing patterns |
| Download completed | A file finishes downloading | Auto-organize downloads |
| History visited | You visit a matching URL | Log visits to competitor sites |
| Idle state change | You go idle/return | Summarize session on idle |
| Browser startup | Chrome starts | Morning briefing |
| Context menu | Custom right-click option | Analyze selected text |
| Window events | Window created/focused/closed | Workspace tracking |

### Context Menu Hooks

Context menu hooks add custom items to the right-click menu under "Send to CHAOS agent":

```
You: Add a context menu item called "Explain this" that explains any selected text

Agent: [Uses hook_create with trigger: {type: "context-menu", label: "Explain this"}]
Done. Right-click any selected text and choose "Explain this" to get an explanation.
```

## Skills

Skills extend an agent's knowledge with installable instruction packages.

### Installing from a URL

```
You: Install the skill from https://github.com/user/chaos-skills/tree/main/web-scraping

Agent: [Uses fetch_skill to download SKILL.md and reference files from the repo]
Installed "Web Scraping" skill with 3 reference files. I now have detailed
instructions for scraping websites including handling pagination, rate limits,
and dynamic content.
```

### Installing from Content

```
You: Install this as a skill:

# SKILL.md
---
name: Code Review
description: Thorough code review with security focus
---

When reviewing code, always check for:
1. SQL injection
2. XSS vulnerabilities
...

Agent: [Uses install_skill to save the content]
Installed "Code Review" skill.
```

### Managing Skills

```
You: What skills do you have installed?

Agent: [Uses list_skills]
I have 2 skills installed:
1. Web Scraping (v1.0) - from github.com/user/chaos-skills
2. Code Review - installed from pasted content
```

```
You: Remove the code review skill

Agent: [Uses remove_skill]
Removed "Code Review" skill.
```

### How Skills Work

Skills are injected into the agent's system prompt at the start of each conversation. The SKILL.md content appears after the agent's CLAUDE.md instructions. Reference files in the skill's `reference/` directory are available for the agent to read via file tools but are not automatically included in the prompt (to save token budget).

## Scheduled Tasks

Agents can schedule recurring or one-time tasks using Chrome alarms.

### Creating Scheduled Tasks

Via chat:
```
You: Every morning at 9am, check my bookmarks from yesterday and summarize them

Agent: [Uses alarm_set with periodInMinutes: 1440 and a detailed prompt]
Set up a daily task. Every 24 hours I'll review yesterday's bookmarks,
read their content, and write a summary to my notes.
```

### Managing Tasks

In the Agent Settings view, the **Scheduled Tasks** section shows:
- Task name and description
- Schedule (one-time or recurring interval)
- Last run time and result
- Run history (last 10 executions)
- **Run Now** button for immediate execution
- **Delete** button to remove

### How Scheduling Works

Chrome alarms fire even when the dashboard is closed (as long as Chrome is running). When an alarm fires:
1. The background service worker looks up the scheduled task
2. Runs the full agentic loop with the stored prompt
3. Records the result and duration in run history

## Keyboard Shortcuts

The dashboard supports standard keyboard shortcuts:

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (in chat input) |
| `Shift+Enter` | New line in chat input |
| `Ctrl/Cmd+K` | Focus chat input |

## Agent Memory

Each agent has a private file system (OPFS) that persists across sessions:

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Agent's personality and instructions. The agent can self-edit this. |
| `activity-log.jsonl` | Automatically appended after each interaction. |
| `TODO.md` | Task list maintained by the agent. |
| `memories/` | Topic-specific memory files. |
| `people/` | Notes about people mentioned in conversations. |
| `ideas/` | Captured ideas and explorations. |
| `bookmarks/` | Cached content from pages the agent has read. |
| `conversations/` | Recent conversation history. |
| `skills/` | Installed skill packages. |

You can browse these files in the **Files** view of the dashboard.

### Self-Editing

Agents can and do edit their own `CLAUDE.md` to learn preferences. For example:
```
You: Always respond in bullet points

Agent: [Writes to CLAUDE.md learned preferences section]
Got it. I've updated my preferences to always use bullet points.
```

## Tips

- **Use the master agent for orchestration**: Let it decide when to delegate vs handle directly.
- **Create specialists**: A dedicated "researcher" agent remembers research context across sessions.
- **Use hooks for automation**: Set up bookmark hooks, tab hooks, or idle hooks to make agents work automatically.
- **Check agent files**: Browse the Files view to see what your agent remembers.
- **Multiple columns**: Open several chat columns to work on different threads simultaneously.
- **Context menu**: Right-click selected text or pages to send them directly to an agent.
- **Scheduled reviews**: Set up daily or weekly review tasks so agents proactively organize information.
