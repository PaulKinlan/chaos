# Chat

Talk to your agents in real time. Each column is a separate conversation with an agent.

## What This View Does

The Chat view is your primary interface for interacting with agents. You can have multiple conversations open side by side, each targeting a different agent. Messages you send are processed by the agent using its configured model, tools, and CLAUDE.md instructions.

## Columns

- Click **+ Add Column** to open a new conversation
- Each column targets one agent -- pick from the dropdown in the column header
- Close columns with the X button
- Columns persist across sessions so you can pick up where you left off

## Mentions

- Type `@` in the message input to mention another agent by name
- The mentioned agent receives context about the conversation
- Use mentions to bring in specialist agents without switching columns

## Delegation

- Press `Ctrl+Enter` or click the **Delegate** button to hand off a task
- The master agent creates a job on the shared board and a sub-agent picks it up
- Delegation is how complex tasks get broken into smaller pieces across agents
- Track delegated work in the Jobs view

## Page Context

- Click **Read Page** to grab the current browser tab's content
- The agent can then answer questions about the page you are viewing
- Useful for summarizing articles, extracting data, or analyzing content

## Voice Input

- Click the microphone button for speech-to-text input
- Speak naturally -- the transcription is sent as your message
- Keyboard shortcut: `Ctrl+Shift+U`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+Enter` | Delegate to sub-agent |
| `Ctrl+Shift+C` | Open CHAOS sidebar |
| `Ctrl+Shift+U` | Voice input |

## Tips

- Start with the master agent for general tasks -- it knows how to delegate to specialists
- Use page context before asking questions about what you are reading
- Keep different projects in different columns for clean context separation
- The agent remembers conversation history within each column
- If an agent seems stuck, try rephrasing or breaking your request into smaller steps
