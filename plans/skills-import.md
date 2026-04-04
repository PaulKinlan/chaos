# Plan: Skills Import

## Problem

Agents are currently configured only through their CLAUDE.md template and the tools we've built in. There's no way to give an agent specialised knowledge or capabilities from external sources. Meanwhile, there's a growing ecosystem of skills/prompts/tool packs:

- Claude Code skills (`.claude/skills/`, `.agents/skills/`)
- Impeccable design skills (already installed in this repo)
- Community prompt libraries
- MCP tool servers
- Custom WASM tools (already partially supported)

An agent should be able to import a skill pack from the web that gives it new instructions, workflows, and tool-usage patterns without modifying the core extension code.

## What is a skill?

A skill is a bundle of:
1. **Instructions** (markdown) - injected into the agent's system prompt or CLAUDE.md
2. **Reference material** (optional markdown files) - domain knowledge the agent can read
3. **Tool hints** (optional) - which tools the agent should prefer and how to use them
4. **Example prompts** (optional) - sample tasks the skill enables

A skill does NOT contain executable code. It's pure configuration/knowledge. This keeps it safe to import from untrusted sources.

```
skill-pack/
  SKILL.md              # Main skill instructions (required)
  reference/            # Optional reference docs
    topic-a.md
    topic-b.md
  examples.md           # Optional example prompts
  manifest.json         # Metadata: name, description, author, version, tags
```

## How skills work at runtime

### Injection into the agent loop

When the agent loop starts, it reads the agent's installed skills and injects them into the system prompt:

```
[CLAUDE.md - base personality]
[Skill 1: SKILL.md content]
[Skill 2: SKILL.md content]
```

Reference files aren't injected by default (too much context). Instead, the agent gets a tool or instruction to read them on demand:

```
You have the following skills installed:
- Frontend Design (impeccable) - reference files available in skills/frontend-design/reference/
- API Security Review - reference files available in skills/api-security/reference/

Use read_file to access skill reference material when needed.
```

### Storage

Skills are stored in the agent's OPFS under `skills/`:

```
/agents/{agent-id}/
  skills/
    frontend-design/
      SKILL.md
      reference/
        typography.md
        color-and-contrast.md
    api-security/
      SKILL.md
      reference/
        owasp-top-10.md
  skill-manifest.json    # List of installed skills with metadata
```

### Per-agent skills

Each agent has its own skill set. A researcher agent might have different skills than a coder agent. The master agent could have orchestration-specific skills.

## Import sources

### 1. URL fetch (simplest)

User provides a URL to a skill pack (ZIP or GitHub repo). The agent fetches and installs it.

**From a GitHub repo:**
```
Import skill from: https://github.com/pbakaus/impeccable
```
The agent (or a helper function) fetches the repo, finds the SKILL.md and reference files, and saves them to the agent's skills directory.

**From a ZIP URL:**
```
Import skill from: https://example.com/skills/api-review-v1.zip
```
Fetch, unzip, validate manifest, save.

### 2. Claude Code skills marketplace

Claude Code has a skills system with `npx skills add` and `.agents/skills/` directories. We could:
- Parse the same skill format (SKILL.md with frontmatter)
- Fetch from the same GitHub-based distribution
- The skills are already just markdown files

### 3. Paste/manual entry

User pastes a SKILL.md into a textarea in the agent settings. Simplest possible import.

### 4. Agent self-discovery

The master agent could search for and install skills based on the task at hand:
```
User: "Review this React component for accessibility issues"
Master: "I don't have an accessibility review skill. Let me search for one..."
→ Searches a skill registry/marketplace
→ Installs an a11y review skill
→ Uses it for the task
```

This is more advanced but very powerful.

## Implementation

### Phase 1: Manual skill import

**Skill storage** (`src/agents/skills.ts`):
```typescript
interface SkillMeta {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  source?: string;  // URL where it was imported from
  installedAt: string;
  files: string[];  // Relative paths within the skill directory
}

async function installSkill(agentId: string, skillDir: string, files: Map<string, string>): Promise<SkillMeta>
async function removeSkill(agentId: string, skillId: string): Promise<void>
async function listSkills(agentId: string): Promise<SkillMeta[]>
async function getSkillContent(agentId: string, skillId: string): Promise<string>  // Returns SKILL.md
```

**Agent loop integration** (`src/agents/agentic-loop.ts`, `src/agents/loop.ts`):
- On each run, read `skills/skill-manifest.json` from OPFS
- For each installed skill, read its SKILL.md
- Append skill instructions to the system prompt
- Add a note about available reference files

**UI: Agent Settings → Skills section**:
- List of installed skills with name, description, author
- Remove button per skill
- "Add Skill" button with options:
  - Paste SKILL.md content
  - Import from URL
  - Browse installed skills (from the repo's `.agents/skills/`)

### Phase 2: URL-based import

**Skill fetcher** (`src/agents/skill-fetcher.ts`):
```typescript
async function fetchSkillFromGitHub(repoUrl: string): Promise<Map<string, string>>
async function fetchSkillFromZip(zipUrl: string): Promise<Map<string, string>>
async function fetchSkillFromUrl(url: string): Promise<Map<string, string>>  // Auto-detect
```

GitHub fetching:
- Parse owner/repo from URL
- Use GitHub API to list files in the skill directory
- Fetch each file's content
- Look for SKILL.md, reference/ directory, manifest.json

**Agent tool: install_skill**:
```typescript
install_skill({
  source: 'https://github.com/pbakaus/impeccable',
  name: 'frontend-design'  // optional, inferred from repo
})
```

This lets agents install skills on themselves or on sub-agents:
```
Master: "I need a code review skill for the reviewer agent"
→ find_agent({ role: 'reviewer' })
→ install_skill({ agentId: reviewer.id, source: '...' })
```

### Phase 3: Skill registry / marketplace

A simple JSON registry listing available skills:

```json
{
  "skills": [
    {
      "id": "impeccable-frontend-design",
      "name": "Frontend Design (Impeccable)",
      "description": "Design vocabulary and audit commands for frontend work",
      "author": "pbakaus",
      "source": "https://github.com/pbakaus/impeccable",
      "tags": ["design", "frontend", "css", "accessibility"]
    },
    {
      "id": "api-security-review",
      "name": "API Security Review",
      "description": "OWASP-based API security analysis",
      "source": "https://github.com/example/api-security-skill",
      "tags": ["security", "api", "owasp"]
    }
  ]
}
```

The registry could be:
- A GitHub repo with a JSON file
- A simple static website
- Curated by the CHAOS community

**UI: Skill Browser**:
- Search/filter by tags
- Preview skill description
- One-click install

### Phase 4: Agent self-discovery

The master agent gets a `search_skills` tool:
```typescript
search_skills({ query: 'accessibility review react' })
→ Returns matching skills from the registry
```

And `install_skill` to self-install based on the task.

## Skill format compatibility

### Claude Code skills

Claude Code skills use this format:
```markdown
---
name: skill-name
description: What it does
user-invocable: true
argument-hint: "[area]"
---

Instructions for the agent...
```

We should support this frontmatter format. The `name` becomes the skill ID, the `description` is shown in the UI. The body is the SKILL.md content.

### MCP tools

MCP is different - it provides executable tools, not instructions. We could support MCP by:
- Connecting to an MCP server
- Importing its tool definitions
- Making them available in the agent's tool set

This is separate from skills (which are knowledge/instructions) but complementary. See the external channels plan for MCP integration.

## Security considerations

- Skills are markdown only - no executable code
- Reference files are markdown only
- No `<script>` tags in markdown rendering (DOMPurify handles this)
- Skills can't modify the agent's core CLAUDE.md (they're appended, not replacing)
- Skills can't access other agents' data
- URL-based imports should validate the source (HTTPS only, size limits)
- The agent still decides how to use skills - a malicious skill can't force tool calls

## Open questions

1. **Skill conflicts**: What if two skills give contradictory instructions? Priority order? Last-installed wins?

2. **Context window cost**: Each installed skill adds to the system prompt. With many skills, this could be expensive. Should we dynamically include only relevant skills based on the task?

3. **Skill updates**: If a skill is updated at the source, should we auto-update? Or is it manual? Version pinning?

4. **Skill sharing between agents**: Should agents share a skill library, or is it per-agent? Per-agent is simpler and matches the current model.

5. **Skill composition**: Can skills reference other skills? ("This skill requires the base frontend-design skill")

## Related

- Impeccable design skills (already installed in `.agents/skills/`)
- WASM tools (existing tool extension mechanism)
- Agent role templates (skills could replace or supplement templates)
- MCP servers (external channels plan - tools, not knowledge)
