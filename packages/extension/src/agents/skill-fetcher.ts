/**
 * Skill Fetcher
 *
 * Fetches skills from GitHub repositories and direct URLs.
 * Supports:
 *   - https://github.com/user/repo (looks for SKILL.md at root)
 *   - https://github.com/user/repo/tree/main/path/to/skill (specific skill dir)
 *   - Direct raw URL to a SKILL.md file
 *
 * Uses the GitHub Contents API for proper directory traversal
 * and reference file discovery.
 */

import { parseFrontmatter } from './skills.js';

// ── Types ──

export interface FetchedSkill {
  files: Map<string, string>;
  meta: {
    name: string;
    description: string;
    author?: string;
    version?: string;
  };
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
  size: number;
}

// ── GitHub URL parsing ──

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  // Match: https://github.com/user/repo
  // Match: https://github.com/user/repo/tree/branch
  // Match: https://github.com/user/repo/tree/branch/path/to/dir
  // Match: https://github.com/user/repo/blob/branch/path/to/file
  const match = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/,
  );
  if (!match) return null;

  const [, owner, repo, _treeOrBlob, branch, path] = match;
  return {
    owner,
    repo,
    branch: branch || 'main',
    path: path || '',
  };
}

// ── GitHub API helpers ──

function log(msg: string, data?: Record<string, unknown>): void {
  const parts = data ? Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '';
  console.log(`[skill-fetcher] ${msg}${parts ? ' ' + parts : ''}`);
}

async function githubApiGet(url: string): Promise<Response> {
  log('GitHub API request', { url });
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });
  log('GitHub API response', { url, status: resp.status });
  return resp;
}

/**
 * List contents of a directory in a GitHub repo.
 */
async function listGitHubDir(
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<GitHubContentItem[]> {
  const apiPath = path ? `/${path}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents${apiPath}?ref=${branch}`;
  const response = await githubApiGet(url);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch a single file's content from GitHub.
 */
async function fetchGitHubFile(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${downloadUrl}: ${response.status}`);
  }
  return response.text();
}

/**
 * Recursively fetch all markdown files from a GitHub directory.
 * Used for reference/ directories.
 */
async function fetchDirFiles(
  owner: string,
  repo: string,
  dirPath: string,
  branch: string,
  prefix: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const items = await listGitHubDir(owner, repo, dirPath, branch);

  for (const item of items) {
    if (item.type === 'file' && item.download_url && item.name.endsWith('.md')) {
      const content = await fetchGitHubFile(item.download_url);
      files.set(`${prefix}/${item.name}`, content);
    } else if (item.type === 'dir') {
      const subFiles = await fetchDirFiles(
        owner, repo, item.path, branch, `${prefix}/${item.name}`,
      );
      for (const [subPath, content] of subFiles) {
        files.set(subPath, content);
      }
    }
  }

  return files;
}

// ── Public API ──

/**
 * Fetch a skill from a GitHub repo URL.
 *
 * Strategy:
 * 1. Parse the URL to get owner/repo/path
 * 2. Use GitHub API to list the directory
 * 3. Look for SKILL.md in the response
 * 4. Also look for reference/ directory and fetch those files
 * 5. Parse SKILL.md frontmatter for name/description
 * 6. Return the file map + metadata
 *
 * If the URL points directly at a SKILL.md blob, fetch it directly.
 */
export async function fetchSkillFromGitHub(repoUrl: string): Promise<FetchedSkill | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    log('Failed to parse GitHub URL', { url: repoUrl });
    return null;
  }

  const { owner, repo, branch, path } = parsed;
  log('Fetching skill from GitHub', { owner, repo, branch, path });
  const files = new Map<string, string>();

  // List the target directory
  const items = await listGitHubDir(owner, repo, path, branch);
  log('Root directory listing', { items: items.length, names: items.map(i => i.name) });

  // Find SKILL.md
  const skillFile = items.find(
    (item) => item.type === 'file' && item.name === 'SKILL.md',
  );

  if (!skillFile?.download_url) {
    log('No SKILL.md at root, searching subdirectories...');
    // SKILL.md not found at this level. Try looking in common subdirectories.
    // Some repos have skills in skills/ or .agents/skills/ directories.
    const skillDirs = items.filter(
      (item) => item.type === 'dir' && (item.name === 'skills' || item.name === '.agents'),
    );
    log('Candidate skill dirs', { dirs: skillDirs.map(d => d.name) });

    for (const dir of skillDirs) {
      const subItems = await listGitHubDir(owner, repo, dir.path, branch);
      log(`Listing ${dir.name}/`, { items: subItems.length, names: subItems.map(i => i.name) });

      // If this dir contains SKILL.md directly
      const subSkill = subItems.find(
        (item) => item.type === 'file' && item.name === 'SKILL.md',
      );
      if (subSkill?.download_url) {
        log('Found SKILL.md in', { dir: dir.name });
        const content = await fetchGitHubFile(subSkill.download_url);
        files.set('SKILL.md', content);

        const refDir = subItems.find(
          (item) => item.type === 'dir' && item.name === 'reference',
        );
        if (refDir) {
          const refFiles = await fetchDirFiles(owner, repo, refDir.path, branch, 'reference');
          for (const [refPath, refContent] of refFiles) {
            files.set(refPath, refContent);
          }
        }
        break;
      }

      // If this dir contains a "skills" subdir (e.g. .agents/skills/), go deeper
      const skillsSubDir = subItems.find(
        (item) => item.type === 'dir' && item.name === 'skills',
      );
      const dirsToSearch = skillsSubDir
        ? await listGitHubDir(owner, repo, skillsSubDir.path, branch)
        : subItems.filter((i) => i.type === 'dir');

      log('Searching skill subdirectories', { count: dirsToSearch.length, names: dirsToSearch.map(d => d.name) });

      // Collect ALL skills from subdirectories into one combined SKILL.md
      const skillParts: string[] = [];
      for (const subDir of dirsToSearch) {
        if (subDir.type !== 'dir') continue;
        const deepItems = await listGitHubDir(owner, repo, subDir.path, branch);
        const deepSkill = deepItems.find(
          (item) => item.type === 'file' && item.name === 'SKILL.md',
        );
        if (deepSkill?.download_url) {
          log(`Found SKILL.md in ${subDir.name}/`);
          const content = await fetchGitHubFile(deepSkill.download_url);
          skillParts.push(`## ${subDir.name}\n\n${content}`);

          const refDir = deepItems.find(
            (item) => item.type === 'dir' && item.name === 'reference',
          );
          if (refDir) {
            const refFiles = await fetchDirFiles(owner, repo, refDir.path, branch, `reference/${subDir.name}`);
            for (const [refPath, refContent] of refFiles) {
              files.set(refPath, refContent);
            }
          }
        }
      }

      if (skillParts.length > 0) {
        log(`Combined ${skillParts.length} skills from ${dir.name}`);
        files.set('SKILL.md', skillParts.join('\n\n---\n\n'));
        break;
      }

      if (files.has('SKILL.md')) break;
    }

    if (!files.has('SKILL.md')) {
      // Last resort: try raw.githubusercontent.com directly (fallback for simple repos)
      const basePath = path ? `${path}/` : '';
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${basePath}SKILL.md`;
      log('Trying raw fallback', { url: rawUrl });
      const response = await fetch(rawUrl);
      if (response.ok) {
        files.set('SKILL.md', await response.text());
        log('Raw fallback succeeded');
      } else {
        log('Raw fallback failed', { status: response.status });
        return null;
      }
    }
  } else {
    // Found SKILL.md at the target path
    log('Found SKILL.md at root level');
    const content = await fetchGitHubFile(skillFile.download_url);
    files.set('SKILL.md', content);

    // Look for reference/ directory
    const refDir = items.find(
      (item) => item.type === 'dir' && item.name === 'reference',
    );
    if (refDir) {
      const refPath = path ? `${path}/reference` : 'reference';
      const refFiles = await fetchDirFiles(owner, repo, refPath, branch, 'reference');
      for (const [filePath, refContent] of refFiles) {
        files.set(filePath, refContent);
      }
    }
  }

  // Parse metadata from SKILL.md frontmatter
  const skillContent = files.get('SKILL.md')!;
  const { meta: fmMeta } = parseFrontmatter(skillContent);

  // Derive name from repo if not in frontmatter
  const name = fmMeta.name || `${owner}/${repo}${path ? `/${path}` : ''}`;
  const description = fmMeta.description || `Skill from ${repoUrl}`;

  return {
    files,
    meta: {
      name,
      description,
      author: fmMeta.author || owner,
      version: fmMeta.version,
    },
  };
}

/**
 * Fetch a skill from a direct URL (raw SKILL.md or any markdown file).
 */
export async function fetchSkillFromDirectUrl(url: string): Promise<FetchedSkill | null> {
  log('Fetching skill from direct URL', { url });
  const response = await fetch(url);
  if (!response.ok) {
    log('Direct URL fetch failed', { url, status: response.status });
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const content = await response.text();

  // Accept markdown, plain text, or content that looks like markdown
  if (
    !contentType.includes('text/markdown') &&
    !contentType.includes('text/plain') &&
    !url.endsWith('.md') &&
    !content.startsWith('---') &&
    !content.startsWith('#')
  ) {
    return null;
  }

  const { meta: fmMeta } = parseFrontmatter(content);
  const files = new Map<string, string>();
  files.set('SKILL.md', content);

  // Derive name from URL if not in frontmatter
  const urlName = url
    .replace(/^https?:\/\//, '')
    .split('/')
    .slice(-1)[0]
    .replace(/\.md$/, '');

  return {
    files,
    meta: {
      name: fmMeta.name || urlName,
      description: fmMeta.description || `Imported from ${url}`,
      author: fmMeta.author,
      version: fmMeta.version,
    },
  };
}

/**
 * Auto-detect URL type and fetch appropriately.
 *
 * Tries GitHub API first, falls back to direct URL fetch.
 */
export async function fetchSkillFromUrl(url: string): Promise<FetchedSkill> {
  log('fetchSkillFromUrl', { url });

  // Try GitHub first
  if (url.includes('github.com')) {
    const result = await fetchSkillFromGitHub(url);
    if (result) {
      log('GitHub fetch succeeded', { files: result.files.size, name: result.meta.name });
      return result;
    }
    log('GitHub fetch returned null');
  }

  // Try direct URL
  const result = await fetchSkillFromDirectUrl(url);
  if (result) {
    log('Direct URL fetch succeeded', { name: result.meta.name });
    return result;
  }

  log('All fetch methods failed', { url });
  throw new Error(
    `Could not fetch a skill from ${url}. Expected a GitHub repository with a SKILL.md file or a direct URL to a markdown file.`,
  );
}
