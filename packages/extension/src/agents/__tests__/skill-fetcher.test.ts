/**
 * Tests for the Skill Fetcher module.
 *
 * Mocks global fetch to simulate GitHub API responses
 * and direct URL fetches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchSkillFromGitHub,
  fetchSkillFromDirectUrl,
  fetchSkillFromUrl,
} from '../skill-fetcher.js';

// ── Mock OPFS (required by skills.ts -> parseFrontmatter dependency chain) ──

vi.mock('../../storage/opfs.js', () => ({
  opfs: {
    readFile: vi.fn(async () => { throw new Error('Not found'); }),
    writeFile: vi.fn(async () => {}),
    appendFile: vi.fn(async () => {}),
    readLines: vi.fn(async () => []),
    listDir: vi.fn(async () => []),
    mkdir: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
}));

// ── Fetch mock ──

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: string | object, ok = true, headers?: Record<string, string>) {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchSkillFromGitHub', () => {
  it('returns null for non-GitHub URLs', async () => {
    const result = await fetchSkillFromGitHub('https://example.com/skill');
    expect(result).toBeNull();
  });

  it('fetches SKILL.md from repo root via API', async () => {
    // First call: GitHub API listing of repo root
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com/repos/user/repo/contents?ref=main')) {
        return mockResponse([
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/SKILL.md', size: 100 },
          { name: 'README.md', path: 'README.md', type: 'file', download_url: 'https://raw.githubusercontent.com/user/repo/main/README.md', size: 50 },
        ]);
      }
      if (url.includes('raw.githubusercontent.com/user/repo/main/SKILL.md')) {
        return mockResponse(`---
name: test-skill
description: A test skill from GitHub
author: testuser
version: 1.0.0
---

# Test Skill

Instructions here.`);
      }
      return mockResponse('', false);
    });

    const result = await fetchSkillFromGitHub('https://github.com/user/repo');
    expect(result).not.toBeNull();
    expect(result!.meta.name).toBe('test-skill');
    expect(result!.meta.description).toBe('A test skill from GitHub');
    expect(result!.meta.author).toBe('testuser');
    expect(result!.files.has('SKILL.md')).toBe(true);
  });

  it('fetches SKILL.md and reference files', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com/repos/user/repo/contents?ref=main')) {
        return mockResponse([
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file', download_url: 'https://raw.example.com/SKILL.md', size: 100 },
          { name: 'reference', path: 'reference', type: 'dir', download_url: null, size: 0 },
        ]);
      }
      if (url.includes('api.github.com/repos/user/repo/contents/reference?ref=main')) {
        return mockResponse([
          { name: 'topic-a.md', path: 'reference/topic-a.md', type: 'file', download_url: 'https://raw.example.com/reference/topic-a.md', size: 50 },
        ]);
      }
      if (url.includes('raw.example.com/SKILL.md')) {
        return mockResponse('# Main skill instructions');
      }
      if (url.includes('raw.example.com/reference/topic-a.md')) {
        return mockResponse('# Topic A reference');
      }
      return mockResponse('', false);
    });

    const result = await fetchSkillFromGitHub('https://github.com/user/repo');
    expect(result).not.toBeNull();
    expect(result!.files.has('SKILL.md')).toBe(true);
    expect(result!.files.has('reference/topic-a.md')).toBe(true);
    expect(result!.files.get('reference/topic-a.md')).toBe('# Topic A reference');
  });

  it('handles repo URL with tree/branch/path', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com/repos/user/repo/contents/skills/my-skill?ref=main')) {
        return mockResponse([
          { name: 'SKILL.md', path: 'skills/my-skill/SKILL.md', type: 'file', download_url: 'https://raw.example.com/skills/my-skill/SKILL.md', size: 100 },
        ]);
      }
      if (url.includes('raw.example.com/skills/my-skill/SKILL.md')) {
        return mockResponse(`---
name: my-skill
description: Nested skill
---
# My Skill`);
      }
      return mockResponse('', false);
    });

    const result = await fetchSkillFromGitHub('https://github.com/user/repo/tree/main/skills/my-skill');
    expect(result).not.toBeNull();
    expect(result!.meta.name).toBe('my-skill');
  });

  it('falls back to raw.githubusercontent.com when API returns no SKILL.md', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return mockResponse([]); // Empty directory listing
      }
      if (url.includes('raw.githubusercontent.com/user/repo/main/SKILL.md')) {
        return mockResponse('# Fallback skill');
      }
      return mockResponse('', false);
    });

    const result = await fetchSkillFromGitHub('https://github.com/user/repo');
    expect(result).not.toBeNull();
    expect(result!.files.get('SKILL.md')).toBe('# Fallback skill');
  });

  it('returns null when no SKILL.md found anywhere', async () => {
    mockFetch.mockImplementation(async () => mockResponse('', false));

    const result = await fetchSkillFromGitHub('https://github.com/user/empty-repo');
    expect(result).toBeNull();
  });
});

describe('fetchSkillFromDirectUrl', () => {
  it('fetches a markdown file from a direct URL', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(`---
name: direct-skill
description: Fetched directly
---

# Direct Skill

Do the thing.`, true, { 'content-type': 'text/markdown' }),
    );

    const result = await fetchSkillFromDirectUrl('https://example.com/skill.md');
    expect(result).not.toBeNull();
    expect(result!.meta.name).toBe('direct-skill');
    expect(result!.files.has('SKILL.md')).toBe(true);
  });

  it('accepts content that starts with # even without markdown content-type', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse('# My Skill\n\nInstructions.', true, { 'content-type': 'application/octet-stream' }),
    );

    const result = await fetchSkillFromDirectUrl('https://example.com/skill.md');
    expect(result).not.toBeNull();
  });

  it('returns null for non-markdown content', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse('<html><body>Not markdown</body></html>', true, { 'content-type': 'text/html' }),
    );

    const result = await fetchSkillFromDirectUrl('https://example.com/page.html');
    expect(result).toBeNull();
  });

  it('returns null for failed fetches', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('', false));

    const result = await fetchSkillFromDirectUrl('https://example.com/missing.md');
    expect(result).toBeNull();
  });
});

describe('fetchSkillFromUrl', () => {
  it('uses GitHub fetcher for github.com URLs', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com/repos/user/repo/contents?ref=main')) {
        return mockResponse([
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file', download_url: 'https://raw.example.com/SKILL.md', size: 100 },
        ]);
      }
      if (url.includes('raw.example.com/SKILL.md')) {
        return mockResponse('# GitHub skill');
      }
      return mockResponse('', false);
    });

    const result = await fetchSkillFromUrl('https://github.com/user/repo');
    expect(result.meta.name).toBeDefined();
    expect(result.files.has('SKILL.md')).toBe(true);
  });

  it('falls back to direct URL for non-GitHub URLs', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse('# Direct skill', true, { 'content-type': 'text/plain' }),
    );

    const result = await fetchSkillFromUrl('https://example.com/skill.md');
    expect(result.files.has('SKILL.md')).toBe(true);
  });

  it('throws when nothing works', async () => {
    mockFetch.mockResolvedValue(mockResponse('', false));

    await expect(fetchSkillFromUrl('https://example.com/nothing')).rejects.toThrow(
      /Could not fetch a skill/,
    );
  });
});
