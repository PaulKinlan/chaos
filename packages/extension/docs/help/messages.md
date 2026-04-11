# Messages

Inter-agent communication -- what agents send to each other during task delegation and collaboration.

## What This View Does

The Messages view shows the messages that flow between agents when they delegate tasks, report results, and coordinate work. This is the communication layer that makes multi-agent collaboration possible.

## Sent and Received

- **Sent** messages are ones this agent dispatched to other agents
- **Received** messages are ones other agents sent to this agent
- Use the filter dropdown to show only sent, only received, or all messages

## Direction Badges

- Messages are tagged with direction indicators so you can see the flow
- Inbound messages show who sent them and why
- Outbound messages show who they were sent to and what was requested

## How Delegation Messages Work

1. You ask the master agent to do something complex
2. The master agent breaks it into sub-tasks and sends messages to specialist agents
3. Each specialist agent receives a message with instructions and context
4. As specialists complete their work, they send result messages back
5. The master agent aggregates results and responds to you

## Message Content

- Each message includes the task description, relevant context, and any constraints
- Results include the agent's output, artifacts created, and status (success/failure)
- Messages may reference specific tools, files, or artifacts

## Searching

- Use the search box to find messages by content
- Helpful for tracking down specific task communications
- Filter by agent to see only one agent's message history

## Tips

- Use Messages to debug delegation issues -- if a sub-agent is not doing what you expect, check what instructions it received
- Messages give you visibility into the "conversation" between agents that happens behind the scenes
- Large delegation chains create many messages -- use filters to focus on what matters
- Messages are a read-only log -- you cannot edit or resend them
- If delegation is not working well, check that the receiving agent has the right skills configured
