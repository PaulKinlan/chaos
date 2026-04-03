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

## Full Tool Inventory for Inter-Agent Work

### Existing tools (already implemented, available to all agents)

| Tool | Purpose | Notes |
|------|---------|-------|
| `agent_discover` | List visible agents with name, role, visibility | Agents set to 'private' are hidden |
| `message_send` | Send a message to a specific agent or broadcast | Free-form body, agents negotiate format |
| `message_read` | Read messages received by this agent | Filter by sender, time, limit |
| `task_create` | Create a shared task with optional dependencies | `blockedBy` for DAG ordering |
| `task_update` | Update task status (in_progress, completed, failed) | With optional result text |
| `task_list` | List tasks, filter by agent/status/unblocked | Event-sourced from JSONL |
| `artifact_publish` | Copy a file to shared artifacts space | With description metadata |
| `artifact_list` | List shared artifacts | Filter by producer agent |
| `artifact_read` | Read a shared artifact's content | |

### New tools needed (master-only unless noted)

| Tool | Purpose | Who can use | Notes |
|------|---------|-------------|-------|
| `create_agent` | Spawn a new sub-agent | Master only | Takes name, role, purpose (injected into CLAUDE.md) |
| `delete_agent` | Archive/remove a sub-agent | Master only | Optionally preserve memory |
| `assign_task` | Create task + assign + trigger execution | Master only | Like task_create but also wakes the sub-agent |
| `get_agent_status` | Check agent's current activity | Master only | Recent actions, pending tasks, last active |
| `find_agent` | Search agents by role, capability, or name | Any agent | More targeted than agent_discover |
| `set_agent_hook` | Configure a hook on another agent | Master only | Master can tell sub-agent what to watch |
| `set_agent_schedule` | Set a scheduled task on another agent | Master only | Master can schedule work on sub-agents |

### Tool interaction patterns

**Master delegates a task:**
```
master calls assign_task({
  agentId: "researcher-123",
  description: "Research OpenClaw ecosystem",
  prompt: "Search the web for recent OpenClaw news...",
  notifyOnComplete: true
})
→ Creates task in shared board
→ Triggers sub-agent's agentic loop with the prompt
→ When sub-agent completes, master receives a message
```

**Sub-agent reports back:**
```
sub-agent completes work
→ Publishes artifact: "research-openclaw-2026-04-03.md"
→ Updates task status to 'completed' with result summary
→ Sends message to master: "Research complete. Key findings: ..."
```

**Master checks on progress:**
```
master calls get_agent_status({ agentId: "researcher-123" })
→ Returns: {
    status: "running",
    currentTask: "Research OpenClaw ecosystem",
    lastActivity: "2 min ago - fetched page https://...",
    pendingTasks: 0
  }
```

## Sub-Agent Lifecycle

### Creation

Sub-agents can be created two ways:

1. **User-created** (via + button): Persistent. User chose the name and role. Not auto-deleted.
2. **Master-created** (via create_agent tool): Can be persistent or temporary.

When the master creates an agent, it specifies:
- `name`: descriptive name for the task
- `role`: one of the role templates
- `purpose`: injected into the sub-agent's CLAUDE.md as additional context
- `temporary`: if true, the agent is archived after its current task completes

### Temporary agents

For one-off complex tasks, the master creates a temporary specialist:
```
master: "I need deep research on quantum computing trends"
→ create_agent("Quantum Researcher", "researcher", "Focus on quantum computing...", temporary: true)
→ assign_task(...)
→ Sub-agent does the work, publishes artifact
→ Master reads artifact, sends final response to user
→ Sub-agent archived (OPFS preserved but agent removed from active list)
```

Temporary agents:
- Don't appear as persistent tabs (or appear grayed out when idle)
- Are archived after task completion (removed from agent list, OPFS kept for reference)
- Can be "revived" if the user wants to continue the conversation

### Archival

Archived agents:
- Removed from the active agent tabs
- OPFS storage preserved (memory, artifacts, logs)
- Can be viewed in an "Archived Agents" section in settings
- Can be restored to active

## Task Handoff Protocol

When the master assigns a multi-stage task, the handoff works like this:

```
Step 1: Master creates the pipeline
  task_create({ id: "stage-1", subject: "Research", owner: "researcher-123" })
  task_create({ id: "stage-2", subject: "Write report", owner: "writer-456", blockedBy: ["stage-1"] })
  task_create({ id: "stage-3", subject: "Review", owner: "reviewer-789", blockedBy: ["stage-2"] })

Step 2: Researcher picks up stage-1 (unblocked)
  → Runs agentic loop
  → Publishes artifact
  → Marks stage-1 complete

Step 3: Writer sees stage-2 is now unblocked (stage-1 complete)
  → Triggered by alarm check or master notification
  → Reads researcher's artifact
  → Writes the report
  → Publishes artifact
  → Marks stage-2 complete

Step 4: Reviewer sees stage-3 is now unblocked
  → Reviews the report
  → Publishes reviewed artifact
  → Marks stage-3 complete

Step 5: Master detects all stages complete
  → Reads final artifact
  → Presents result to user
```

The dependency DAG in the shared task board (already implemented) handles the ordering. The missing piece is triggering sub-agents when their blocked tasks become unblocked.

**Trigger mechanism options:**

A. **Polling**: Sub-agents check for unblocked tasks on a schedule (e.g., every 5 min via alarm). Simple but slow.

B. **Master-driven**: Master monitors task completions and explicitly triggers the next agent. More responsive but master needs to stay active.

C. **Event-driven**: Task completion fires a hook that triggers the next agent. Most elegant, uses existing hooks infrastructure.

**Recommendation**: Option C. When a task status changes to 'completed', check if any blocked tasks are now unblocked. If so, trigger those agents' agentic loops. This can be built into the task_update flow.

## Master Agent CLAUDE.md

The master agent needs a special CLAUDE.md section explaining its orchestration role:

```markdown
## You Are the Master Agent

You are the primary agent the user interacts with. You can handle tasks directly
or delegate to specialist sub-agents.

### When to delegate
- The task requires deep expertise in a specific area (research, code review, writing)
- The task has multiple distinct phases (research → write → review)
- You want parallel execution (multiple aspects investigated simultaneously)
- The task is recurring and a specialist can handle it independently

### When NOT to delegate
- Simple questions or quick tasks
- Tasks you can handle in one agentic loop step
- When the user explicitly wants to talk to YOU

### How to delegate
1. Check if an appropriate sub-agent exists: use `find_agent` or `agent_discover`
2. If not, create one: use `create_agent` with a clear purpose
3. Assign the task: use `assign_task` with a detailed prompt
4. Monitor progress: use `get_agent_status` periodically
5. When complete: read the artifact, compile the result, report to the user

### Managing sub-agents
- Keep sub-agents focused on their specialty
- Don't create too many — each costs resources
- Use temporary agents for one-off tasks
- Archive agents when they're no longer needed
```

## Revert Plan

Tagged as `v0.1.0-pre-master-agent` before implementation. If the master agent model doesn't work:

```bash
git checkout v0.1.0-pre-master-agent
```

This restores the per-agent-tab model with no master concept.
