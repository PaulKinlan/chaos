/**
 * Example 9: Skills System
 *
 * Skills are instructions that extend an agent's capabilities.
 * They're injected into the system prompt and can come with tools.
 *
 * Run: npx tsx examples/09-skills.ts
 */

import { createAgent, InMemorySkillStore, parseSkillMd } from '@chaos/agent-loop';
import { createAnthropic } from '@ai-sdk/anthropic';

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

// Create a skill store and install some skills
const skills = new InMemorySkillStore();

// Skills are defined in markdown format
const codeReviewSkill = parseSkillMd(`---
id: code-review
name: Code Review
description: Expert code reviewer that checks for bugs, security issues, and best practices
author: example
version: 1.0.0
---

# Code Review Skill

When reviewing code:
1. Check for security vulnerabilities (SQL injection, XSS, etc.)
2. Look for common bugs (off-by-one, null checks, race conditions)
3. Evaluate readability and naming conventions
4. Suggest improvements with specific examples
5. Note what's done well — be constructive
`);

await skills.install(codeReviewSkill);

const agent = createAgent({
  id: 'reviewer',
  name: 'Code Reviewer',
  model: model as any,
  systemPrompt: 'You are a code review assistant.',
  skills, // Skills are automatically included in the system prompt
  maxIterations: 5,
});

const result = await agent.run(`Review this code:
\`\`\`js
app.get('/user/:id', (req, res) => {
  const query = "SELECT * FROM users WHERE id = " + req.params.id;
  db.query(query, (err, result) => res.json(result));
});
\`\`\``);

console.log(result);
