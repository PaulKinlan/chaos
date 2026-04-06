# Plan: Skills Import

## Status (audited 2026-04-04)

### Phase 1: Manual skill import — DONE
- [x] `src/agents/skills.ts` with `SkillMeta`, `installSkill()`, `removeSkill()`, `listSkills()`, `getSkillContent()`, `getSkillManifest()`, `parseFrontmatter()`, `buildSkillsPromptSection()`
- [x] Agent loop integration in both `agentic-loop.ts` and `loop.ts` (calls `buildSkillsPromptSection()`)
- [x] Agent tools: `install_skill`, `remove_skill`, `list_skills`, `fetch_skill` in `src/tools/skills/`
- [x] Background port handlers: `listSkills`, `installSkill`, `removeSkill`, `importSkillFromUrl`, `fetchSkillPreview`
- [x] Background one-shot handlers: `listSkills`, `installSkill`, `removeSkill`, `fetchSkillPreviewOneShot`, `importSkillFromUrlOneShot`
- [x] Tests: 13 tests in `src/agents/__tests__/skills.test.ts`

### Phase 2: URL-based import — DONE
- [x] `src/agents/skill-fetcher.ts` with `fetchSkillFromGitHub()`, `fetchSkillFromDirectUrl()`, `fetchSkillFromUrl()`
- [x] GitHub API support: owner/repo/branch/path parsing, `/repos/contents` API, recursive reference discovery
- [x] Fallback to `raw.githubusercontent.com` and direct URL fetch
- [x] `src/tools/skills/fetch-skill.ts` uses skill-fetcher module
- [x] Background handler `importSkillFromUrl` updated
- [x] Preview-before-install flow (`fetchSkillPreview` handlers)
- [x] UI: "Browse Skills" section with curated featured skills
- [x] Tests: 13 tests in `src/agents/__tests__/skill-fetcher.test.ts`

### Phase 3: Skill registry / marketplace — TODO
- [ ] No JSON registry or marketplace API found
- [ ] No skill browser with search/filter by tags (only curated featured list in UI)

### Phase 4: Agent self-discovery — DONE
- [x] `search_skills` tool (searches installed, featured, GitHub API)
- [x] `auto_install_skill` tool (fetch + install in one step)
- [x] Master template updated to check skills before creating agents
- [x] FEATURED_SKILLS extracted to shared module

---

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

A skill MAY contain executable code (JavaScript/TypeScript). However, running untrusted code in a Chrome extension is risky (prompt injection, data exfiltration, privilege escalation). For now, we only process the markdown/instruction content. Executable code in skills is a future consideration that needs a proper sandbox (possibly WASM-based or via the offscreen document).

**Skills from untrusted sources are NOT inherently safe.** Even pure markdown skills can contain prompt injection that alters agent behavior in undesirable ways. We need validation and review mechanisms (TODO).

```
skill-pack/
  SKILL.md              # Main skill instructions (required) - STANDARD in Claude Code
  reference/            # Optional reference docs - STANDARD in Claude Code (used by Impeccable)
    topic-a.md
    topic-b.md
  examples.md           # Optional example prompts - PROPOSED (not standard)
  manifest.json         # Optional metadata - PROPOSED (not standard, could use SKILL.md frontmatter instead)
```

Note: The `SKILL.md` file with YAML frontmatter is the standard format used by Claude Code skills. The `reference/` directory is also standard (used by Impeccable's frontend-design and critique skills). `manifest.json` and `examples.md` are proposed extensions — we may not need them if SKILL.md frontmatter covers the metadata needs.

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

### Phase 1: Manual skill import ✅ IMPLEMENTED

**Skill storage** (`src/agents/skills.ts`):
- `SkillMeta` interface with id, name, description, author, version, source, installedAt, files
- `installSkill()`, `removeSkill()`, `listSkills()`, `getSkillContent()`, `getSkillManifest()`
- `parseFrontmatter()` for YAML frontmatter in SKILL.md files
- `buildSkillsPromptSection()` generates system prompt injection text

**Agent loop integration** (`src/agents/agentic-loop.ts`, `src/agents/loop.ts`):
- Both loops call `buildSkillsPromptSection()` after reading CLAUDE.md
- Skills are injected under `## Installed Skills` with per-skill `### Skill: Name` headers
- Reference file paths listed for on-demand reading
- Graceful handling when no skills are installed

**Agent tools** (`src/tools/skills/`):
- `install_skill` — install from pasted SKILL.md content + optional reference files
- `remove_skill` — remove by skill ID
- `list_skills` — list all installed skills
- `fetch_skill` — fetch and install from URL (GitHub repos and direct SKILL.md links)
- All tools registered in the tool lookup registry

**Background message handlers** (`src/background.ts`):
- Port handlers: listSkills, installSkill, removeSkill, importSkillFromUrl
- One-shot handlers: listSkills, installSkill, removeSkill

**UI: Agent Settings → Skills section**:
- List of installed skills with name, description, author, source, version, installed date, file count
- Remove button per skill
- "Add Skill" area with:
  - URL input with "Import" button (GitHub repos or direct URLs)
  - Name, description, and SKILL.md textarea with "Install Skill" button

**Tests** (`src/agents/__tests__/skills.test.ts`):
- 13 tests covering: frontmatter parsing, install/list/remove lifecycle, overwrite, reference files, prompt section building

### Phase 2: URL-based import ✅ IMPLEMENTED

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

**What was implemented:**

- `src/agents/skill-fetcher.ts` with `fetchSkillFromGitHub()`, `fetchSkillFromDirectUrl()`, `fetchSkillFromUrl()` (auto-detect)
- GitHub API support: parses owner/repo/branch/path from URLs, uses `/repos/contents` API, discovers SKILL.md and reference/ directories recursively
- Falls back to `raw.githubusercontent.com` for simple repos
- Falls back to direct URL fetch for non-GitHub URLs
- `src/tools/skills/fetch-skill.ts` updated to use the skill-fetcher module
- Background handler `handleImportSkillFromUrl` updated to use skill-fetcher (fetches reference files too)
- New background handler `handleFetchSkillPreview` for preview-before-install flow
- New one-shot handlers: `fetchSkillPreviewOneShot`, `importSkillFromUrlOneShot`
- UI: Import from URL now shows a preview (name, author, version, description, file list, content preview) before installing
- UI: "Browse Skills" section with curated featured skills (4 entries), one-click install
- Tests: 13 tests for skill-fetcher (GitHub API, reference files, branch/path parsing, direct URL, fallback, error cases)

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

**Skills are NOT inherently safe.** Even markdown-only skills can:
- Contain prompt injection that alters agent behavior
- Instruct the agent to exfiltrate data via tools (fetch_page, message_send)
- Override safety guidelines in the agent's system prompt
- Conflict with other skills in harmful ways

Mitigations (TODO - not all implemented in Phase 1):
- **Preview before install**: Show the full SKILL.md content before installing
- **Skill review**: Flag skills that reference sensitive tools or contain suspicious patterns
- **Sandboxed execution**: Any executable code in skills must run in a sandbox (WASM worker, offscreen document, or sandboxed iframe). Not supported in Phase 1.
- **Skill permissions**: Let users approve which tools a skill can instruct the agent to use
- **Source trust levels**: Distinguish between curated/verified skills and community/unknown skills
- Skills can't modify the agent's core CLAUDE.md (they're appended, not replacing)
- Skills can't access other agents' data
- URL-based imports should validate the source (HTTPS only, size limits)

### Executable code in skills

Some skill ecosystems include JavaScript/TypeScript code. We currently cannot run this safely in a Chrome extension context. Options for the future:
- Run in a WASM sandbox (already have the infrastructure from co-do)
- Run in an offscreen document with restricted CSP
- Run in a sandboxed iframe with no extension API access
- Simply don't run it and only use the markdown instructions

For Phase 1, executable code in skills is ignored. Only SKILL.md and reference markdown files are processed.

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
