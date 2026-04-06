# Hooks

Hooks trigger your agent automatically when browser events happen. Unlike channels (which receive external messages), hooks respond to things happening in your browser.

### Hooks vs Channels
- **Hooks** fire on browser events (bookmarks, tabs, downloads)
- **Channels** receive messages from external services (Telegram, Discord)

### Trigger Types
- **Bookmark Created** — when you bookmark a page
- **Tab Navigated** — when a tab loads a matching URL
- **Tab Created/Closed** — when tabs open or close
- **Download Completed** — when a file finishes downloading
- **Page Visited** — when a URL appears in history
- **Browser Startup** — when Chrome launches
- **Context Menu** — right-click actions
- **Clipboard Changed** — when clipboard content changes
- And more — idle state, window events, omnibox commands

### Writing Prompts
- The prompt tells the agent what to do when the event fires
- Be specific: "Read the bookmarked page, summarize it, save to memories/"
- The agent runs with full tool access, just like a chat message

### Refine Button
- Click **Refine** to have AI improve your hook prompt
- It adds detail and structure to make the hook more reliable

### Quick Start Presets
- Use the preset palette to create common hooks instantly
- Presets come pre-configured with triggers and prompts
