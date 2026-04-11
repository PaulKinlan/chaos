# Scheduled Tasks

Run your agents on a recurring schedule -- like cron jobs for AI.

## What This View Does

Scheduled Tasks let you automate agent work on a timer. Define a prompt and a schedule, and the agent executes it automatically at each interval. Results are tracked in run history so you can see what happened.

## How Tasks Work

- Each task has a prompt (what to do) and a schedule (when to do it)
- The agent runs the prompt with full tool access at each scheduled interval
- Tasks execute even when the CHAOS sidebar is closed, using Chrome alarms
- Results and artifacts from each run are recorded

## Creating a Task

1. Click **+ Create Task**
2. Write a prompt describing what the agent should do
3. Choose a schedule: every hour, daily, weekly, or a custom cron expression
4. Select which agent should run it
5. The task starts running at the next scheduled time

## Task Timeline

- Each task shows its recent runs with timestamps and status
- Click a run to see the agent's output, tool calls, and any artifacts created
- Failed runs show error details so you can fix the prompt or configuration

## Managing Tasks

- **Pause/Resume** -- temporarily stop a task without deleting it
- **Edit** -- change the prompt or schedule of an existing task
- **Delete** -- permanently remove a task
- **Run Now** -- trigger a task immediately, outside its normal schedule

## Example Tasks

- "Check my GitHub notifications and summarize anything important" -- daily
- "Read the top stories on Hacker News and save a summary" -- every 6 hours
- "Review my open browser tabs and suggest which ones to close" -- weekly

## Tips

- Start with simple prompts and refine based on run results
- Use **Run Now** to test a task before relying on its schedule
- Check run history regularly to make sure tasks are producing useful output
- Combine tasks with hooks for event-driven plus scheduled automation
- Keep prompts specific -- vague prompts produce inconsistent results
