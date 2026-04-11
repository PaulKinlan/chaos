# Agent Memory

Each agent has a virtual filesystem where it stores notes, context, and learned information.

## What This View Does

The Memory view is a file browser for an agent's virtual filesystem. Agents read and write files here to remember things, store instructions, and track tasks. This is how agents persist knowledge across conversations and sessions.

## File Browser

- The left panel shows the agent's file tree
- Click a file to view its contents in the right panel
- Files are organized however the agent sees fit
- You can create, edit, and delete files directly

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | The agent's system instructions -- personality, guidelines, constraints |
| `TODO.md` | Tasks the agent is tracking for itself |
| `memories/` | Notes the agent writes about you and your preferences |

Agents may create additional files and folders as needed during tasks.

## How Agents Learn

- Agents write to memory during conversations and tasks
- Over time, they build up context about your preferences and patterns
- Memory persists across sessions -- agents remember what they have learned
- You can review and edit what agents have stored about you

## CLAUDE.md

- This is the most important file -- it defines how the agent behaves
- Edit it to change the agent's personality, add constraints, or give standing instructions
- Changes take effect on the agent's next interaction
- You can also edit CLAUDE.md from the Agent Settings view

## Downloading and Uploading

- Select a file and click **Download** to save it locally
- Upload files to give agents reference material or data to work with
- Useful for backing up agent notes or migrating between setups

## Tips

- Review what agents store in `memories/` periodically -- correct anything wrong
- Use CLAUDE.md to give agents persistent instructions they should always follow
- If an agent is behaving unexpectedly, check its files for outdated or conflicting notes
- You can pre-populate an agent's filesystem with reference documents before giving it tasks
- Agents share the artifact store but have separate filesystems -- each agent's memory is private
