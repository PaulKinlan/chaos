/**
 * skills-demo.ts — Agent with skill store.
 *
 * Creates an InMemorySkillStore, installs a skill, and creates an agent that
 * has skill management tools (search, install, list, remove). Shows how skills
 * are loaded into the system prompt and discoverable at runtime.
 *
 * Run: npx tsx examples/skills-demo.ts
 *      npx tsx examples/skills-demo.ts --provider anthropic
 */

import { createAgent, InMemorySkillStore, buildSkillsPrompt } from 'agent-do';
import { resolveModel, isRealProvider } from './lib/model.js';

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
const model = await resolveModel([
  { toolCalls: [{ toolName: 'list_skills', args: {} }] },
  { text: 'You have the Code Review skill installed. It provides PR review guidelines.' },
]);

const agent = createAgent({
  id: 'skilled',
  name: 'Skilled Agent',
  model,
  skills: store,
});

// Use a more natural prompt for real providers
const prompt = isRealProvider()
  ? 'Use the list_skills tool to show me what skills are installed.'
  : 'What skills do I have?';

console.log('\nRunning agent with skills...\n');
const result = await agent.run(prompt);
console.log('Agent response:', result);
