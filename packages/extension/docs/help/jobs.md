# Jobs

Jobs are work items posted to a shared board -- like a Kanban board for AI agents.

## What This View Does

The Jobs view shows all work items across your agent system. When you ask the master agent to delegate a task, it posts a job to the shared board. Sub-agents with matching skills claim jobs and work on them. You can track progress, view results, and manage the queue.

## How Jobs Work

1. You ask an agent to do something that requires delegation
2. The agent posts a job to the shared board with a description and requirements
3. Sub-agents with matching skills automatically claim open jobs
4. Jobs move through statuses: **Open** > **In Progress** > **Completed** or **Failed**
5. Results flow back to the originating agent

## Jobs Board

- All jobs are listed with their current status, assigned agent, and creation time
- Open jobs are waiting to be claimed by a suitable agent
- In-progress jobs show which agent is working on them
- Completed and failed jobs show their final results

## Timeline View

- Click a job to expand its full timeline
- See every event: creation, agent assignment, progress updates, tool calls, completion
- Tool calls show exactly what the agent did and what results it got
- Useful for understanding how agents approach tasks

## Filtering

- Filter by **status** to see only open, in-progress, completed, or failed jobs
- Filter by **agent** to see only one agent's work
- Click an agent's name in the sidebar to jump to their jobs
- Use filters to clean up the view when many jobs accumulate

## Creating Jobs

- Ask your agent: "Delegate this to a sub-agent"
- The master agent decides how to break work into jobs and which skills are needed
- You can also create jobs implicitly by giving the master agent complex multi-step tasks

## Deleting Jobs

- Click the delete button on a job card to remove it
- Completed and failed jobs can be cleaned up without affecting active work
- Deleting an in-progress job does not stop the agent -- it just removes the tracking

## Tips

- Let the master agent handle delegation -- it knows which sub-agents have which skills
- Check failed jobs to understand what went wrong and refine your request
- Use the timeline view to learn how agents break down complex tasks
- Keep the board clean by deleting old completed jobs periodically
- If jobs stay open and unclaimed, check that you have agents with the right skills configured
