# Plan: Master Agent + Shared Workspace

## Summary

One master agent is the primary interface. Most users only ever interact with this agent. The master can create specialist sub-agents when work requires it. Artifacts and tasks are shared across all agents as a common workspace. Each agent keeps its own private memory.

## Core Model

### Master Agent

- Created automatically on install (already happens: "Assistant", neutral role)
- Marked as `master: true` in AgentMeta
- The default landing page is the master agent's chat
- The user talks to the master for everything
- The master plans work, breaks it down, delegates to sub-agents when needed
- The master has a `create_agent` tool so it can spin up specialists on its own
- The master can also do work directly (it has all the same tools as any agent)

### Sub-Agents (Specialists)

- Created by the master agent OR by the user via the + button
- Have a specific role (researcher, coder, writer, etc.)
- Appear as secondary tabs alongside the master
- The user CAN drop into a sub-agent's tab to:
  - See what it's working on
  - Ask it follow-up questions
  - Browse its memory
  - See its hooks and scheduled tasks
- Sub-agents can set up their own hooks and scheduled tasks based on their role
- Sub-agents are NOT required. A single master agent works fine for most users.

### Shared Workspace

**Artifacts**: Top-level, shared across all agents.
- Any agent can publish an artifact
- Any agent can read artifacts from other agents
- The user sees all artifacts in one place
- This is how agents pass work products between each other

**Tasks**: Top-level, shared across all agents.
- The master creates tasks and assigns them to sub-agents
- Sub-agents can also create tasks for each other
- The user sees all tasks in one place: queued, running, complete
- Scheduled/recurring tasks shown here too

**Messages**: Shared inter-agent communication log.
- Master → sub-agent instructions
- Sub-agent → master status updates and results
- Sub-agent → sub-agent coordination
- The user can see all of this for transparency

### Private (Per-Agent)

**Memory**: Each agent's OPFS storage (memories/, people/, ideas/, CLAUDE.md, activity-log.jsonl, TODO.md) is private to that agent. The master doesn't read sub-agents' memory directly. They communicate through messages and artifacts.

**Conversations**: Per-agent chat history. The master has its own conversation thread. Each sub-agent has its own.

**Hooks**: Per-agent. The master might instruct a sub-agent to set up a hook, or a sub-agent might decide on its own based on its role and context.

## UI Changes

### Navigation (minimal change from current)

```
[Master Agent]  [Sub-Agent 1]  [Sub-Agent 2]  [+]  ⚙

Sidebar:
  Chat          (per-agent)
  Tasks         (SHARED - top level)
  Messages      (SHARED - top level)
  Artifacts     (SHARED - top level)
  Memory        (per-agent)
  Hooks         (per-agent)
  Agent         (per-agent settings)
```

The key change: Tasks, Messages, and Artifacts show ALL data across all agents when viewed from any tab. They're not filtered to the active agent by default (though a filter dropdown is available).

The master agent tab could have a subtle visual distinction (e.g., a star/crown icon, slightly different tab style) to indicate it's the primary.

### Default landing

When you open a new tab: master agent's chat view. This is where most interaction happens.

### Sub-agent creation flow

Two paths:

1. **User creates**: Click +, pick role, name it. Same as now.
2. **Master creates**: During an agentic loop, the master decides it needs a specialist. It calls `create_agent` tool with a role and purpose. The sub-agent tab appears. The master sends it a task via the shared task board.

## New Tools for Master Agent

### `create_agent`
- Input: { name, role, purpose (written into the sub-agent's CLAUDE.md) }
- Creates a new agent with the specified role
- Returns the agent ID so the master can send it tasks/messages
- Only available to the master agent

### `assign_task`
- Input: { agentId, description, prompt, blockedBy? }
- Creates a task in the shared task board assigned to the specified agent
- The sub-agent picks it up on its next agentic loop iteration (or via a scheduled alarm)

### `get_agent_status`
- Input: { agentId }
- Returns: agent's current status, recent activity, pending tasks
- Lets the master check on sub-agents

### `broadcast_message`
- Input: { message }
- Sends a message to all visible agents
- For announcements, context updates

## Execution Flow

### Simple task (master handles it)

```
User: "What's the weather like?"
Master: [uses web search tool, responds directly]
```

No sub-agents involved. Same as today.

### Complex task (master delegates)

```
User: "Research the OpenClaw ecosystem and write a detailed report"
Master:
  1. Thinks: "This needs research then writing. I'll create a researcher."
  2. Calls create_agent("OpenClaw Researcher", "researcher", "Focus on OpenClaw ecosystem...")
  3. Calls assign_task(researcher_id, "Research OpenClaw...", prompt)
  4. Tells user: "I've created a researcher agent and assigned the task. I'll compile the report when research is done."

Researcher agent (triggered by task):
  1. Runs agentic loop with the task prompt
  2. Does web searches, reads pages, takes notes
  3. Publishes research artifact to shared space
  4. Marks task as complete
  5. Sends message to master: "Research complete, see artifact"

Master (picks up the message, possibly via scheduled check):
  1. Reads the artifact
  2. Writes the report (or creates a writer agent for this)
  3. Responds to user with the final report
```

### Recurring task (master sets up, sub-agent executes)

```
User: "Every morning, give me a summary of tech news"
Master:
  1. Checks if a researcher sub-agent exists, creates one if not
  2. Sets up a scheduled task on the researcher: daily at 8am
  3. Sets up a hook on itself: when researcher publishes a daily-news artifact, summarize it and notify user
```

## Migration

### Phase 1: Mark master agent + shared views
- Add `master: boolean` to AgentMeta
- First agent created on install is marked as master
- Tasks, Messages, Artifacts views show ALL agents' data (add agent filter dropdown)
- Master agent tab gets a visual indicator

### Phase 2: Master tools
- Add create_agent, assign_task, get_agent_status, broadcast_message tools
- Only available to the master agent
- Master's CLAUDE.md updated to explain its orchestration role

### Phase 3: Automatic sub-agent management
- Master creates and tears down sub-agents as needed
- Task handoff protocol: task created → sub-agent picks up → artifact published → master notified
- Sub-agents can be temporary (created for a task, archived when done)

### Phase 4: Polish
- Sub-agent activity visible from master's chat (inline status updates)
- "Delegate" button in chat UI (explicitly tell master to delegate current request)
- Job/task timeline view showing the full execution flow across agents

## Open Questions

1. **Sub-agent lifecycle**: Should sub-agents persist forever or be temporary? Maybe both: user-created agents persist, master-created agents can be marked as temporary and archived after their task completes.

2. **Master failover**: What if the master is misconfigured or its CLAUDE.md gets corrupted? Need a way to designate a new master or reset.

3. **Cost control**: Master creating sub-agents means more LLM calls. Should there be a limit on how many sub-agents the master can create? Or a user confirmation before creation?

4. **Notification flow**: When a sub-agent completes a task, how does the user know? Desktop notification? Badge on the master tab? Inline message in the master's chat?

5. **Sub-agent visibility**: Should the user see ALL sub-agent activity in the master's chat? Or only summaries? Too much detail clutters the master conversation. Too little makes it opaque.
