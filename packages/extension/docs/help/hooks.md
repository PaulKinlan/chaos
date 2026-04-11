# Hooks

Trigger your agent automatically when browser events happen -- bookmarks, downloads, tab changes, and more.

## What This View Does

Hooks let you set up automatic agent actions in response to browser events. Unlike channels (which receive external messages), hooks respond to things happening inside your browser. When an event fires, the agent runs your prompt with the event context.

## Hooks vs Channels

- **Hooks** fire on browser events (bookmarks, tabs, downloads, clipboard)
- **Channels** receive messages from external services (Telegram, Discord, webhooks)
- Both trigger agent execution, but the source is different

## Trigger Types

| Trigger | Fires When |
|---------|------------|
| Bookmark Created | You bookmark a page |
| Tab Navigated | A tab loads a matching URL |
| Tab Created | A new tab opens |
| Tab Closed | A tab closes |
| Download Completed | A file finishes downloading |
| Page Visited | A URL appears in browser history |
| Browser Startup | Chrome launches |
| Context Menu | You right-click and select a custom action |
| Clipboard Changed | Clipboard content changes |
| Idle State | You go idle or return from idle |
| Window Events | Windows open, close, or focus changes |
| Omnibox | You type a command in the address bar |

## Writing Prompts

- The prompt tells the agent what to do when the event fires
- Be specific: "Read the bookmarked page, summarize it in 3 sentences, and save to memories/"
- The agent runs with full tool access, just like a chat message
- Event data (URL, title, file path, etc.) is automatically included in the context

## Refine Button

- Click **Refine** to have AI improve your hook prompt
- It adds detail, structure, and edge case handling
- Useful if you have a rough idea but want a more reliable prompt

## Quick Start Presets

- Use the preset palette to create common hooks instantly
- Presets come pre-configured with triggers and prompts
- Customize after creation to fit your specific needs

## Context Menu Hooks

- Create hooks that appear in the browser's right-click menu
- Select text, right-click, and run your agent on the selection
- Great for quick lookups, translations, or saving snippets

## Tips

- Start with bookmark or download hooks -- they are the easiest to test
- Keep prompts focused on one action per hook
- Use the Refine button if your hook is not producing consistent results
- Combine hooks with scheduled tasks for comprehensive automation
- Check the Jobs view to see hook-triggered work in progress
- Be careful with high-frequency triggers (tab navigated, clipboard) -- they can generate a lot of agent activity
