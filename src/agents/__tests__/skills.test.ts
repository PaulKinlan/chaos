/**
 * Tests for the Skills module.
 *
 * Tests install/remove/list lifecycle, manifest persistence,
 * and SKILL.md frontmatter parsing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock state ──

const mockFiles: Record<string, string> = {};

// ── OPFS mock ──

vi.mock('../../storage/opfs.js', () => ({
  opfs: {
    readFile: vi.fn(async (path: string) => {
      if (path in mockFiles) return mockFiles[path];
      throw new Error(`File not found: ${path}`);
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      mockFiles[path] = content;
    }),
    appendFile: vi.fn(async (path: string, content: string) => {
      mockFiles[path] = (mockFiles[path] ?? '') + content;
    }),
    readLines: vi.fn(async (path: string, lastN?: number) => {
      if (!(path in mockFiles)) throw new Error(`File not found: ${path}`);
      const lines = mockFiles[path].split('\n').filter((l) => l.length > 0);
      if (lastN !== undefined && lastN > 0) return lines.slice(-lastN);
      return lines;
    }),
    listDir: vi.fn(async () => []),
    mkdir: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
  OPFS: vi.fn(),
}));

// ── Import after mocks ──

import {
  installSkill,
  removeSkill,
  listSkills,
  getSkillContent,
  getSkillManifest,
  parseFrontmatter,
  buildSkillsPromptSection,
} from '../skills.js';

describe('Skills module', () => {
  beforeEach(() => {
    // Clear mock file store
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
  });

  describe('parseFrontmatter', () => {
    it('parses YAML frontmatter from SKILL.md content', () => {
      const content = `---
name: test-skill
description: A test skill
author: tester
version: 1.0.0
---

# Instructions

Do the thing.`;

      const { meta, body } = parseFrontmatter(content);
      expect(meta.name).toBe('test-skill');
      expect(meta.description).toBe('A test skill');
      expect(meta.author).toBe('tester');
      expect(meta.version).toBe('1.0.0');
      expect(body.trim()).toBe('# Instructions\n\nDo the thing.');
    });

    it('returns empty meta and full body when no frontmatter', () => {
      const content = '# Just markdown\n\nNo frontmatter here.';
      const { meta, body } = parseFrontmatter(content);
      expect(meta).toEqual({});
      expect(body).toBe(content);
    });

    it('handles quoted values in frontmatter', () => {
      const content = `---
name: "quoted-name"
description: 'single quoted'
---

Body here.`;

      const { meta } = parseFrontmatter(content);
      expect(meta.name).toBe('quoted-name');
      expect(meta.description).toBe('single quoted');
    });
  });

  describe('install / list / remove lifecycle', () => {
    const agentId = 'test-agent';

    it('installs a skill and lists it', async () => {
      const files = new Map<string, string>();
      files.set('SKILL.md', '# Test Skill\n\nInstructions here.');

      const id = await installSkill(agentId, {
        name: 'Test Skill',
        description: 'A test skill',
      }, files);

      expect(id).toBe('test-skill');

      // Check that SKILL.md was written
      expect(mockFiles[`agents/${agentId}/skills/${id}/SKILL.md`]).toBe('# Test Skill\n\nInstructions here.');

      // Check manifest
      const skills = await listSkills(agentId);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('Test Skill');
      expect(skills[0].description).toBe('A test skill');
      expect(skills[0].id).toBe('test-skill');
      expect(skills[0].files).toEqual(['SKILL.md']);
    });

    it('installs multiple skills', async () => {
      const files1 = new Map([['SKILL.md', '# Skill 1']]);
      const files2 = new Map([['SKILL.md', '# Skill 2']]);

      await installSkill(agentId, { name: 'Skill One', description: 'First' }, files1);
      await installSkill(agentId, { name: 'Skill Two', description: 'Second' }, files2);

      const skills = await listSkills(agentId);
      expect(skills).toHaveLength(2);
    });

    it('removes a skill', async () => {
      const files = new Map([['SKILL.md', '# To Remove']]);
      const id = await installSkill(agentId, { name: 'Remove Me', description: 'Will be removed' }, files);

      await removeSkill(agentId, id);

      const skills = await listSkills(agentId);
      expect(skills).toHaveLength(0);
    });

    it('overwrites a skill with the same ID', async () => {
      const files1 = new Map([['SKILL.md', '# Version 1']]);
      const files2 = new Map([['SKILL.md', '# Version 2']]);

      await installSkill(agentId, { name: 'My Skill', description: 'V1' }, files1);
      await installSkill(agentId, { name: 'My Skill', description: 'V2' }, files2);

      const skills = await listSkills(agentId);
      expect(skills).toHaveLength(1);
      expect(skills[0].description).toBe('V2');

      const content = await getSkillContent(agentId, 'my-skill');
      expect(content).toBe('# Version 2');
    });

    it('installs with reference files', async () => {
      const files = new Map([
        ['SKILL.md', '# Main instructions'],
        ['reference/topic.md', '# Topic reference'],
      ]);

      const id = await installSkill(agentId, { name: 'With Refs', description: 'Has refs' }, files);

      const skills = await listSkills(agentId);
      expect(skills[0].files).toEqual(['SKILL.md', 'reference/topic.md']);
      expect(mockFiles[`agents/${agentId}/skills/${id}/reference/topic.md`]).toBe('# Topic reference');
    });
  });

  describe('getSkillContent', () => {
    it('returns SKILL.md content', async () => {
      const agentId = 'test-agent';
      const files = new Map([['SKILL.md', '# My Content']]);
      const id = await installSkill(agentId, { name: 'Content Test', description: 'test' }, files);
      const content = await getSkillContent(agentId, id);
      expect(content).toBe('# My Content');
    });
  });

  describe('getSkillManifest', () => {
    it('returns the same as listSkills', async () => {
      const agentId = 'test-agent';
      const files = new Map([['SKILL.md', '# Content']]);
      await installSkill(agentId, { name: 'Manifest Test', description: 'test' }, files);

      const manifest = await getSkillManifest(agentId);
      const skills = await listSkills(agentId);
      expect(manifest).toEqual(skills);
    });
  });

  describe('buildSkillsPromptSection', () => {
    const agentId = 'prompt-agent';

    it('returns empty string when no skills installed', async () => {
      const section = await buildSkillsPromptSection(agentId);
      expect(section).toBe('');
    });

    it('includes skill content in prompt section', async () => {
      const files = new Map([['SKILL.md', '# Do the thing\n\nDetailed instructions.']]);
      await installSkill(agentId, { name: 'Prompt Skill', description: 'test' }, files);

      const section = await buildSkillsPromptSection(agentId);
      expect(section).toContain('## Installed Skills');
      expect(section).toContain('### Skill: Prompt Skill');
      expect(section).toContain('# Do the thing');
      expect(section).toContain('Detailed instructions.');
    });

    it('includes reference file hints', async () => {
      const files = new Map([
        ['SKILL.md', '# Main'],
        ['reference/topic.md', '# Reference content'],
      ]);
      await installSkill(agentId, { name: 'Ref Skill', description: 'has refs' }, files);

      const section = await buildSkillsPromptSection(agentId);
      expect(section).toContain('reference files available');
      expect(section).toContain('skills/ref-skill/reference/topic.md');
    });
  });
});
