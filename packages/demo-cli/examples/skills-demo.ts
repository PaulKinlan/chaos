/**
 * skills-demo.ts — Agent with skill store.
 *
 * Creates an InMemorySkillStore, installs a skill, and creates an agent that
 * has skill management tools (search, install, list, remove). Shows how skills
 * are loaded into the system prompt and discoverable at runtime.
 *
 * Run: npx tsx examples/skills-demo.ts
 */

import { createAgent, InMemorySkillStore, buildSkillsPrompt } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';

// Create and populate a skill store
const store = new InMemorySkillStore();
await store.install({
  id: 'code-review',
  name: 'Code Review',
  description: 'Guidelines for reviewing pull requests.',
  content: 'When reviewing code:\n1. Check for correctness\n2. Check for clarity\n3. Suggest improvements',
});

// Show what the system prompt section looks like
const skills = await store.list();
console.log('Skills prompt section:');
console.log(buildSkillsPrompt(skills));

// The agent gets skill tools automatically: search_skills, install_skill, list_skills, remove_skill
const model = createMockModel({
  responses: [
    { toolCalls: [{ toolName: 'list_skills', args: {} }] },
    { text: 'You have the Code Review skill installed. It provides PR review guidelines.' },
  ],
});

const agent = createAgent({
  id: 'skilled',
  name: 'Skilled Agent',
  model,
  skills: store,
});

console.log('\nRunning agent with skills...\n');
const result = await agent.run('What skills do I have?');
console.log('Agent response:', result);
