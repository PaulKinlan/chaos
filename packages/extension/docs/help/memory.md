# Agent Memory

Each agent has a virtual filesystem where it stores notes, context, and learned information.

### File Browser
- The left panel shows the agent's file tree
- Click a file to view its contents in the right panel
- Files are organised however the agent sees fit

### What Gets Stored
- **CLAUDE.md** — the agent's system instructions and personality
- **TODO.md** — tasks the agent is tracking
- **memories/** — notes the agent writes about you and your preferences
- Agents create additional files as needed during tasks

### How Agents Learn
- Agents write to memory during conversations and tasks
- Over time, they build up context about your preferences and patterns
- Memory persists across sessions — agents remember what they've learned

### Downloading Files
- Select a file and click **Download** to save it locally
- Useful for backing up agent notes or reviewing what they've stored
