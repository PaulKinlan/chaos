/**
 * Example 2: Agent with Custom Tools
 *
 * Agents become powerful when they can use tools. The agent autonomously
 * decides which tools to call based on the user's request.
 *
 * This example adds a weather tool and a calculator. The agent will:
 * 1. Receive the user's question
 * 2. Decide which tools to call
 * 3. Call the tools and read the results
 * 4. Formulate a response using the tool results
 *
 * Run: npx tsx examples/02-agent-with-tools.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';

console.log('═══════════════════════════════════════');
console.log('  Example 2: Agent with Custom Tools');
console.log('═══════════════════════════════════════\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

console.log('Setting up agent with 2 tools:');
console.log('  - get_weather(city) → returns mock weather data');
console.log('  - calculate(expression) → evaluates a math expression\n');

const agent = createAgent({
  id: 'weather-bot',
  name: 'Weather Bot',
  model: model as any,
  systemPrompt: 'You help users check the weather. Use the weather tool to get data.',
  maxIterations: 5,
  tools: {
    get_weather: tool({
      description: 'Get current weather for a city',
      parameters: z.object({
        city: z.string().describe('City name'),
      }),
      execute: async ({ city }) => {
        const data = {
          city,
          temperature: Math.round(15 + Math.random() * 15),
          condition: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
        };
        console.log(`         → Tool returned: ${JSON.stringify(data)}`);
        return JSON.stringify(data);
      },
    }),

    calculate: tool({
      description: 'Perform a calculation',
      parameters: z.object({
        expression: z.string().describe('Math expression to evaluate'),
      }),
      execute: async ({ expression }) => {
        try {
          const result = String(Function('"use strict"; return (' + expression + ')')());
          console.log(`         → Tool returned: ${result}`);
          return result;
        } catch {
          return 'Error: Invalid expression';
        }
      },
    }),
  },
});

console.log('── Sending: "What is the weather in London and Paris?" ──');
console.log('   The agent will call get_weather twice (once per city),');
console.log('   then combine the results into a response.\n');

for await (const event of agent.stream('What is the weather in London and Paris?')) {
  switch (event.type) {
    case 'thinking':
      // Agent is generating — we'll see tool calls or text next
      break;
    case 'tool-call':
      console.log(`   [Step ${event.step}] Calling: ${event.toolName}(${JSON.stringify(event.toolArgs)})`);
      break;
    case 'tool-result':
      // Already logged in the execute function
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'step-complete':
      console.log(`   [Step ${event.step} complete]`);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}

console.log('✓ Done — the agent autonomously chose which tools to call.');
