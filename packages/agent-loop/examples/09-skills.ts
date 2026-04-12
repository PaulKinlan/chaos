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

console.log('═══════════════════════════════════════');
console.log('  Example 9: Skills System');
console.log('═══════════════════════════════════════\n');

console.log('Skills are markdown documents that get injected into the system prompt.');
console.log('They give the agent domain-specific instructions without changing its code.\n');

// ── Setup: Install a code review skill ──
console.log('── Setup: Installing a "Code Review" skill ──');
console.log('   The skill teaches the agent to check for:');
console.log('     - Security vulnerabilities (SQL injection, XSS, etc.)');
console.log('     - Common bugs (off-by-one, null checks, race conditions)');
console.log('     - Readability and naming conventions');
console.log('     - Constructive suggestions\n');

const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

const skills = new InMemorySkillStore();

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
console.log('   Skill installed: code-review v1.0.0\n');

const agent = createAgent({
  id: 'reviewer',
  name: 'Code Reviewer',
  model: model as any,
  systemPrompt: 'You are a code review assistant.',
  skills,
  maxIterations: 5,
});

// ── Task: Review a snippet with a SQL injection vulnerability ──
console.log('── Task: Review a code snippet ──');
console.log('   Sending a Node.js route handler with an obvious SQL injection bug.');
console.log('   The skill should guide the agent to catch it.\n');

const codeSnippet = `app.get('/user/:id', (req, res) => {
  const query = "SELECT * FROM users WHERE id = " + req.params.id;
  db.query(query, (err, result) => res.json(result));
});`;

console.log('   Code to review:');
codeSnippet.split('\n').forEach(line => console.log(`   | ${line}`));
console.log('');

const result = await agent.run(`Review this code:\n\`\`\`js\n${codeSnippet}\n\`\`\``);

console.log('   Agent review:\n');
result.split('\n').forEach(line => console.log(`   ${line}`));
console.log('');

console.log('Done — the agent reviewed the code using its installed skill.');
