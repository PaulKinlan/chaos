# Skills Guide

## What Are Skills?

Skills are reusable instruction sets that extend an agent's capabilities. Unlike tools (which provide executable functions), skills inject domain knowledge and behavioral instructions into the agent's system prompt. Think of them as plug-in expertise.

## Skill Interface

A skill is a plain object:

```typescript
interface Skill {
  id: string;        // Unique identifier (kebab-case)
  name: string;      // Human-readable name
  description: string; // What the skill does
  content: string;   // The actual instructions injected into the system prompt
  author?: string;
  version?: string;
}
```

## SKILL.md Format

Skills are typically written as markdown files with YAML frontmatter:

```markdown
---
name: Code Review
description: Reviews code for quality, security, and best practices
author: chaos-team
version: 1.0.0
---

## Code Review Process

When asked to review code:
1. Check for security vulnerabilities
2. Look for performance issues
3. Verify error handling
4. Check naming conventions
5. Suggest improvements

## What to Flag
- SQL injection risks
- Unhandled promise rejections
- Memory leaks
- Race conditions
```

Parse these files with `parseSkillMd()`:

```typescript
import { parseSkillMd } from '@chaos/agent-loop';
import { readFileSync } from 'fs';

const content = readFileSync('code-review.skill.md', 'utf-8');
const skill = parseSkillMd(content);
// skill.id === 'code-review'
// skill.name === 'Code Review'
// skill.content === '## Code Review Process\n...'
```

You can also provide an explicit ID:

```typescript
const skill = parseSkillMd(content, 'my-custom-id');
```

If the file has no frontmatter, the entire content becomes the skill body and the ID defaults to the provided `id` parameter or `'unknown-skill'`.

## SkillStore Interface

Skills are stored and retrieved through a `SkillStore`:

```typescript
interface SkillStore {
  list(): Promise<Skill[]>;
  get(skillId: string): Promise<Skill | undefined>;
  install(skill: Skill): Promise<void>;
  remove(skillId: string): Promise<void>;
  search(query: string): Promise<Array<{ id: string; name: string; description: string; url?: string }>>;
}
```

The package ships with `InMemorySkillStore` for development and testing:

```typescript
import { InMemorySkillStore } from '@chaos/agent-loop';

const store = new InMemorySkillStore();
await store.install({
  id: 'summarizer',
  name: 'Summarizer',
  description: 'Summarizes long text',
  content: 'When asked to summarize, produce a concise 3-bullet summary.',
});
```

## Using Skills with an Agent

Pass a `SkillStore` to `createAgent`:

```typescript
import { createAgent, InMemorySkillStore, parseSkillMd } from '@chaos/agent-loop';
import { anthropic } from '@ai-sdk/anthropic';

const skills = new InMemorySkillStore();

// Pre-install some skills
await skills.install(parseSkillMd(codeReviewSkillMd));
await skills.install(parseSkillMd(writingSkillMd));

const agent = createAgent({
  id: 'skilled-agent',
  name: 'Skilled Agent',
  model: anthropic('claude-sonnet-4-5'),
  skills,
});
```

When the agent runs, all installed skills are loaded and their content is injected into the system prompt under an "Installed Skills" section.

## Installing Skills at Runtime

When you pass a `SkillStore` to `createAgent`, the agent automatically gets four skill-management tools:

| Tool | Description |
|------|-------------|
| `search_skills` | Search for skills matching a query |
| `install_skill` | Install a new skill by providing its definition |
| `list_skills` | List all currently installed skills |
| `remove_skill` | Remove a skill by ID |

This means the agent can discover, install, and manage its own skills during execution:

```typescript
const agent = createAgent({
  id: 'self-improving',
  name: 'Self-Improving Agent',
  model: anthropic('claude-sonnet-4-5'),
  skills: new InMemorySkillStore(),
});

// The agent can now install skills on its own
await agent.run('Search for a data-analysis skill and install it, then analyze this CSV...');
```

## Creating Skill Tools Manually

If you need the skill tools without the full agent setup, use `createSkillTools()`:

```typescript
import { createSkillTools, InMemorySkillStore } from '@chaos/agent-loop';

const store = new InMemorySkillStore();
const tools = createSkillTools(store);
// tools.search_skills, tools.install_skill, tools.list_skills, tools.remove_skill
```

## Building the Skills Prompt Manually

If you're building a custom loop, use `buildSkillsPrompt()` to generate the system prompt section:

```typescript
import { buildSkillsPrompt } from '@chaos/agent-loop';

const skills = await store.list();
const promptSection = buildSkillsPrompt(skills);
// Returns formatted markdown with all skill instructions
```

## Writing Your Own Skills

Good skills:
- Are focused on a specific domain or task type
- Provide clear, actionable instructions
- Include examples where helpful
- Specify what to do and what to avoid

Skills do not need to define tools -- they provide instructions that help the agent use its existing tools more effectively.
