# Agent Settings

Configure how an individual agent behaves, what tools it can use, and its personality.

## What This View Does

Agent Settings lets you customize a specific agent's capabilities, model, instructions, and tools. Each agent can be configured independently, so you can create specialists with different strengths.

## Visibility

- **Active** agents appear in the sidebar and can receive tasks and messages
- **Hidden** agents are archived -- they will not be assigned work or show in the agent list
- Use visibility to temporarily disable agents without deleting them

## Tools

- Toggle which browser tools the agent can access
- Available tools include tab management, bookmarks, history, downloads, clipboard, and more
- Disable tools to restrict what the agent can do -- useful for creating focused specialists
- Tool changes take effect on the agent's next interaction

## Skills

- Skills are capabilities the agent advertises to other agents
- Other agents use skills to decide who to delegate tasks to
- Add skills that describe what this agent is good at (e.g., "web research", "code review", "data analysis")
- Skills are free-form text -- be descriptive so the master agent can make good delegation decisions

## CLAUDE.md Editor

- Edit the agent's system instructions directly
- This is the same file visible in the Files view under `CLAUDE.md`
- Use it to define personality, set constraints, add standing instructions
- Changes take effect on the next interaction

## Model Configuration

- Override the default AI provider and model for this specific agent
- Useful for giving specialist agents a different model (e.g., a cheaper model for simple tasks, a more capable model for complex reasoning)
- If not set, the agent falls back to the global provider configured in Global Settings

## Danger Zone

- **Delete Agent** permanently removes the agent and all its data
- This includes memory, messages, settings, and conversation history
- Deletion cannot be undone -- make sure you want to proceed
- Consider hiding the agent instead if you might want it back later

## Tips

- Give each agent a focused set of skills rather than making every agent a generalist
- Use CLAUDE.md to give agents specific behavioral instructions beyond just skills
- Start with the default model and only override when you have a reason (cost, capability, speed)
- Review tool permissions if an agent is doing things you did not expect
- The master agent does not need every tool -- it delegates to specialists who have the right tools
