# Usage & Costs

Track token consumption, estimate costs, and manage spending across your agents.

## What This View Does

The Usage view shows how many tokens your agents are consuming and what that costs. It helps you understand which agents and tasks use the most resources, so you can optimize your setup and stay within budget.

## Token Tracking

- Every message sent to and received from an AI provider consumes tokens
- Input tokens (your prompts, context, tool results) and output tokens (agent responses) are tracked separately
- Token counts are recorded per agent, per conversation, and per task

## Cost Estimation

- Costs are estimated based on the provider and model being used
- Different models have different per-token pricing
- The view shows both per-session and cumulative cost estimates
- Estimates are approximate -- check your provider's billing dashboard for exact charges

## Per-Agent Breakdown

- See which agents consume the most tokens
- Identify expensive tasks or conversations
- Compare agents running different models to understand cost differences

## Spending Limits

- Set a daily or monthly token budget to prevent runaway costs
- When a limit is reached, agents pause until the next period
- Useful for shared API keys or when experimenting with expensive models

## Tips

- Cheaper models (like Haiku or GPT-4o-mini) work well for routine tasks -- save expensive models for complex work
- Long conversations accumulate context tokens -- start fresh columns periodically
- Scheduled tasks and hooks run automatically, so monitor their token usage
- Use the per-agent breakdown to find agents that might benefit from a cheaper model
- Check usage after setting up new hooks or tasks to make sure they are not more expensive than expected
- Tool-heavy tasks consume more tokens because tool calls and results add to the context
