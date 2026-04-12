/**
 * Example 7: Multi-Agent Orchestration
 *
 * A master agent delegates tasks to specialist workers.
 * The master gets delegate_task, list_agents, and get_agent_status tools.
 *
 * Run: npx tsx examples/07-multi-agent-orchestration.ts
 */

import { createOrchestrator } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const orchestrator = createOrchestrator({
  master: {
    id: 'master',
    name: 'Master',
    model: provider('claude-sonnet-4-6') as any,
    systemPrompt: `You are a master agent. You delegate tasks to specialists.
Available workers: researcher, writer. Use delegate_task to assign work.`,
    maxIterations: 5,
  },
  workers: [
    {
      id: 'researcher',
      name: 'Researcher',
      model: provider('claude-haiku-4-5') as any,
      systemPrompt: 'You are a research specialist. Find and summarize information.',
      maxIterations: 3,
    },
    {
      id: 'writer',
      name: 'Writer',
      model: provider('claude-haiku-4-5') as any,
      systemPrompt: 'You are a writing specialist. Draft clear, concise content.',
      maxIterations: 3,
    },
  ],
});

// The master will decide whether to handle directly or delegate
const result = await orchestrator.run('Write a brief summary about TypeScript');
console.log(result);

// Streaming mode shows which agent is working
for await (const event of orchestrator.stream('Research React and write a paragraph about it')) {
  if (event.type === 'tool-call') console.log(`[${event.toolName}]`);
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}
