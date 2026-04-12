/**
 * Example 2: Agent with Custom Tools
 *
 * Agents become powerful when they can use tools. This example adds
 * a weather tool and a calculator tool.
 *
 * Run: npx tsx examples/02-agent-with-tools.ts
 */

import { createAgent } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

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
        // In a real app, call a weather API
        return JSON.stringify({
          city,
          temperature: Math.round(15 + Math.random() * 15),
          condition: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
        });
      },
    }),

    calculate: tool({
      description: 'Perform a calculation',
      parameters: z.object({
        expression: z.string().describe('Math expression to evaluate'),
      }),
      execute: async ({ expression }) => {
        try {
          // Simple eval for demo — use a proper math parser in production
          return String(Function('"use strict"; return (' + expression + ')')());
        } catch {
          return 'Error: Invalid expression';
        }
      },
    }),
  },
});

// The agent will call get_weather automatically
for await (const event of agent.stream('What is the weather in London and Paris?')) {
  switch (event.type) {
    case 'tool-call':
      console.log(`  [tool] ${event.toolName}(${JSON.stringify(event.toolArgs)})`);
      break;
    case 'tool-result':
      console.log(`  [result] ${event.toolResult}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'done':
      console.log('\n');
      break;
  }
}
