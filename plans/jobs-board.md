# Plan: Jobs Board / Central Task Interface

## Problem

The current UX forces the user to decide which agent should handle each request. You have to pick an agent tab, type your message, and hope you chose the right one. This creates friction:

- "Should I ask the researcher or the coder to investigate this bug?"
- "I want a report written, but it needs research first, then writing, then review"
- The user becomes the orchestrator, manually routing work between agents

Meanwhile, the Tasks, Messages, and Artifacts views are per-agent but the data is actually shared. You have to click into each agent to see what's happening across the system.

## Vision

A central "Jobs Board" as the default NTP view. The user posts tasks. Agents figure out who does what.

```
┌──────────────────────────────────────────────────────────┐
│  CHAOS                                    [+ New Job]  ⚙ │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Jobs Board                                              │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 🟢 Research OpenClaw ecosystem changes              ││
│  │    Assigned: Researcher → Writer                    ││
│  │    Status: Step 3 of 5 — Writing summary            ││
│  │    Started: 2 min ago                               ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ⏳ Review PR #142 and summarize changes              ││
│  │    Assigned: Coder                                  ││
│  │    Status: Queued                                   ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ✅ Daily briefing for March 3                        ││
│  │    Assigned: Planner                                ││
│  │    Status: Complete — 3 min ago                     ││
│  │    [View Result]                                    ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ── Scheduled ──────────────────────────────────────────│
│  │ 🔄 Daily OpenClaw report    Every 24h    Next: 9am  ││
│  │ 🔄 Bookmark summarizer      On trigger   Active     ││
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Jobs Board]  [Agents]  [Activity]  [Settings]          │
└──────────────────────────────────────────────────────────┘
```

## How it works

### 1. User posts a job (not a message to an agent)

The input is at the top of the Jobs Board. The user types what they want done:

- "Research what's happening in the OpenClaw ecosystem this week and write a summary"
- "Check my bookmarks from today and organize them"
- "Review the code in the tab I have open"

No agent selection required. The user describes the outcome, not who should do it.

### 2. A dispatcher assigns the job

When a job is posted, a dispatcher (which could be a lightweight LLM call or a rule-based system) decides:

- Which agent(s) should handle it
- Whether it needs multiple agents in sequence (pipeline)
- Whether agents should collaborate (parallel work + merge)

**Dispatcher options:**

**Option A: LLM-based dispatcher**
A short LLM call that reads the job description + agent roles/capabilities and returns an assignment:
```
Given these agents: [Researcher (web research, summarization), Coder (code analysis, debugging), Writer (drafting, editing)]
And this job: "Research OpenClaw and write a summary"
Assign: Researcher → Writer (pipeline: research first, then writing)
```
Cost: one cheap LLM call per job. Flexible. Can handle novel requests.

**Option B: Rule-based dispatcher**
Pattern matching on keywords:
- "research" / "find" / "search" → Researcher
- "write" / "draft" / "summarize" → Writer
- "code" / "debug" / "review PR" → Coder
- "schedule" / "remind" / "plan" → Planner
- Multiple keywords → pipeline

Cheaper but less flexible. Good for common patterns.

**Option C: Agent self-selection**
Broadcast the job to all agents. Each agent evaluates whether it's a good fit (based on its role, current workload, capabilities) and bids. Highest-confidence agent takes it, or multiple agents form a pipeline.

Most autonomous but slowest and most expensive.

**Recommendation:** Start with Option A (LLM dispatch), fall back to Option B (rules) if no API key is set.

### 3. Agents execute the job

Once assigned, the agentic loop runs. For multi-agent jobs:

**Pipeline:** Agent A completes their part, publishes an artifact, sends a message to Agent B saying "your turn, here's what I found." Agent B picks up and continues.

**Parallel:** Multiple agents work simultaneously on different aspects. Results merged at the end.

**Handoff protocol:**
```
1. Dispatcher creates a Job with stages: [research, write, review]
2. Stage 1: Researcher runs agentic loop, saves result as artifact
3. Dispatcher detects stage 1 complete, triggers stage 2
4. Stage 2: Writer runs with artifact from stage 1 as context
5. Dispatcher detects stage 2 complete, triggers stage 3
6. Stage 3: Reviewer runs with artifact from stage 2
7. Job marked complete, final artifact available to user
```

This uses the existing inter-agent communication (messages + artifacts + shared task board) but with a dispatcher orchestrating the flow.

### 4. User sees progress and results

The Jobs Board shows:
- Active jobs with real-time progress (which step, what the agent is doing)
- Completed jobs with results (click to view full output)
- Scheduled/recurring jobs
- Job history

Clicking a job shows:
- Full execution trace (which agents worked on it, what tools they used)
- Intermediate artifacts
- Final result
- Option to re-run or modify

## Data Model

```typescript
interface Job {
  id: string;
  description: string;        // What the user asked for
  status: 'queued' | 'dispatching' | 'running' | 'complete' | 'failed';
  createdAt: string;
  completedAt?: string;

  // Dispatch result
  stages: JobStage[];
  currentStageIndex: number;

  // Result
  finalResult?: string;
  artifacts?: string[];        // Paths to shared artifacts produced
}

interface JobStage {
  agentId: string;
  agentName: string;
  description: string;        // What this agent should do
  status: 'pending' | 'running' | 'complete' | 'failed';
  startedAt?: string;
  completedAt?: string;
  result?: string;
  artifactPath?: string;
}
```

## UI Changes

### New default view: Jobs Board

Replace the per-agent chat as the default NTP view. The Jobs Board becomes the primary interface.

**Top navigation changes:**
```
[Jobs Board]  [Agent 1]  [Agent 2]  [Agent 3]  [+]  ⚙
```

Jobs Board is a top-level tab alongside agent tabs. It's the default/first tab.

**Jobs Board layout:**
- Input at top: "What do you want done?"
- Active jobs section: cards with progress
- Completed jobs section: cards with results
- Scheduled section: recurring jobs and hooks

### Agent tabs remain

You can still click into an individual agent to:
- Chat directly (for quick one-off questions that don't need dispatch)
- View their memory
- Configure their tools
- See their hooks and scheduled tasks

### Shared views

Tasks, Messages, and Artifacts become views on the Jobs Board (not per-agent):
- All messages across all agents
- All shared tasks
- All artifacts
- Filterable by agent, date, job

## Migration from current UI

The current per-agent tab model stays but becomes secondary. The Jobs Board is added as the new default landing page.

**Phase 1: Add Jobs Board as a new view**
- New sidebar item or top-level tab
- Simple job posting + dispatcher (LLM-based)
- Single-agent jobs only (dispatcher picks one agent)

**Phase 2: Multi-agent pipelines**
- Dispatcher can create multi-stage jobs
- Stage transitions handled automatically
- Artifacts passed between stages

**Phase 3: Agent self-selection and negotiation**
- Agents bid on jobs
- Agents can delegate parts of a job to other agents
- Inter-agent communication used for coordination

**Phase 4: Jobs Board as default**
- Move Jobs Board to be the default NTP view
- Agent tabs become the detail/management view
- Shared views (messages, artifacts) move to Jobs Board

## Open Questions

1. **Dispatcher cost**: Every job needs an LLM call to dispatch. For simple "remind me" tasks, this adds unnecessary latency and cost. Should we bypass dispatch for tasks that match the currently-focused agent?

2. **User override**: Can the user override the dispatcher and assign a job to a specific agent? Yes, probably via @agent mention in the job description.

3. **Job modification**: Can the user modify a running job? (e.g., "actually, also include data from last week"). This would need to interrupt the current stage and re-plan.

4. **Scheduling integration**: Scheduled tasks and hooks should also be expressible as jobs. "Every Monday, research X and write a report" becomes a recurring job.

5. **Priority**: Should jobs have priority levels? If multiple jobs are queued, which runs first?

6. **Concurrency**: Can multiple jobs run simultaneously? The agentic loop is async, so technically yes, but LLM rate limits and cost might be a concern.

7. **Failure handling**: If a stage fails, should the dispatcher retry with a different agent? Or escalate to the user?

## Related

- Current shared task board (`/shared/tasks.jsonl`) - precursor to Jobs Board
- Inter-agent messages - used for pipeline handoffs
- Artifacts - used to pass work between stages
- Scheduled tasks - become recurring jobs
- Hooks - become job triggers
