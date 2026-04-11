/**
 * Project-level tools for the TUI agent.
 *
 * These tools access the PROJECT filesystem (CWD) and shell.
 * They are intentionally named with "project_" prefix to distinguish
 * from the agent's private memory tools (read_file, write_file, etc.)
 * which are provided by @chaos/agent-loop's createFileTools.
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const CWD = process.cwd();

function safePath(p: string): string {
  const resolved = path.resolve(CWD, p);
  if (!resolved.startsWith(CWD)) throw new Error('Path traversal blocked');
  return resolved;
}

/**
 * Create project-level tools — filesystem and shell access scoped to CWD.
 * These are separate from the agent's private memory tools.
 */
export function createProjectTools(): ToolSet {
  return {
    project_read: tool({
      description: 'Read a file from the PROJECT directory (the working directory). Use this to read source code, configs, etc. — NOT for your own memory files.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to project root'),
      })),
      execute: async ({ path: filePath }: { path: string }) => {
        try {
          const full = safePath(filePath);
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          if (lines.length > 500) {
            return `${lines.slice(0, 500).join('\n')}\n\n... (${lines.length - 500} more lines truncated)`;
          }
          return content;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    project_list: tool({
      description: 'List files and directories in the PROJECT directory. Use this to explore the codebase.',
      inputSchema: s(z.object({
        path: z.string().optional().describe('Directory path relative to project root (default: ".")'),
      })),
      execute: async ({ path: dirPath }: { path?: string }) => {
        try {
          const full = safePath(dirPath || '.');
          const entries = fs.readdirSync(full, { withFileTypes: true });
          return entries
            .map((e) => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`)
            .join('\n');
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    project_write: tool({
      description: 'Write content to a file in the PROJECT directory. ONLY use when the user explicitly asks you to create or modify project files.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to project root'),
        content: z.string().describe('File content'),
      })),
      execute: async ({ path: filePath, content }: { path: string; content: string }) => {
        try {
          const full = safePath(filePath);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, content, 'utf-8');
          return `Written ${content.length} bytes to ${filePath}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    project_edit: tool({
      description: 'Edit a file in the PROJECT directory by replacing an exact string match. ONLY use when the user explicitly asks you to modify a file.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to project root'),
        old_string: z.string().describe('Exact text to find and replace'),
        new_string: z.string().describe('Replacement text'),
      })),
      execute: async ({ path: filePath, old_string, new_string }: { path: string; old_string: string; new_string: string }) => {
        try {
          const full = safePath(filePath);
          const content = fs.readFileSync(full, 'utf-8');
          if (!content.includes(old_string)) {
            return 'Error: old_string not found in file';
          }
          const updated = content.replace(old_string, new_string);
          fs.writeFileSync(full, updated, 'utf-8');
          return `Replaced ${old_string.length} chars in ${filePath}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    shell: tool({
      description: 'Run a shell command in the project directory. Use for git, npm, grep, find, etc. Prefer read-only commands unless the user asks for changes.',
      inputSchema: s(z.object({
        command: z.string().describe('Shell command to execute'),
        timeout: z.number().optional().describe('Timeout in ms (default 30000)'),
      })),
      execute: async ({ command, timeout }: { command: string; timeout?: number }) => {
        try {
          const result = child_process.execSync(command, {
            cwd: CWD,
            timeout: timeout || 30_000,
            maxBuffer: 1024 * 1024,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const output = result.toString().trim();
          if (output.length > 10_000) {
            return output.slice(0, 10_000) + '\n\n... (output truncated)';
          }
          return output || '(no output)';
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          return `Error: ${e.stderr || e.message || String(err)}`;
        }
      },
    }),

    project_search: tool({
      description: 'Search file contents in the PROJECT directory for a pattern using grep.',
      inputSchema: s(z.object({
        pattern: z.string().describe('Search pattern (regex)'),
        glob: z.string().optional().describe('File glob to filter (e.g. "*.ts")'),
      })),
      execute: async ({ pattern, glob }: { pattern: string; glob?: string }) => {
        try {
          const globArg = glob ? `--include='${glob}'` : '';
          const result = child_process.execSync(
            `grep -rn ${globArg} '${pattern.replace(/'/g, "\\'")}' . 2>/dev/null | head -50`,
            { cwd: CWD, encoding: 'utf-8', timeout: 10_000 },
          );
          return result.trim() || '(no matches)';
        } catch {
          return '(no matches)';
        }
      },
    }),

    project_info: tool({
      description: 'Get metadata about a file in the PROJECT directory: size, modified time, type.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to project root'),
      })),
      execute: async ({ path: filePath }: { path: string }) => {
        try {
          const full = safePath(filePath);
          const stat = fs.statSync(full);
          return JSON.stringify({
            path: filePath,
            size: stat.size,
            isDirectory: stat.isDirectory(),
            modified: stat.mtime.toISOString(),
          }, null, 2);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  };
}

/**
 * Web tools — fetch URLs and search the web.
 */
export function createWebTools(): ToolSet {
  return {
    fetch_url: tool({
      description: 'Fetch a URL and return its content. For web pages, returns the text content. For APIs, returns the raw response.',
      inputSchema: s(z.object({
        url: z.string().describe('The URL to fetch'),
        method: z.string().optional().describe('HTTP method (default: GET)'),
        headers: z.record(z.string()).optional().describe('Request headers'),
      })),
      execute: async ({ url, method, headers }: { url: string; method?: string; headers?: Record<string, string> }) => {
        try {
          const resp = await fetch(url, {
            method: method || 'GET',
            headers: headers || {},
            signal: AbortSignal.timeout(30_000),
          });
          const contentType = resp.headers.get('content-type') || '';
          let text = await resp.text();

          // For HTML, strip tags for a cleaner text view
          if (contentType.includes('html')) {
            text = text
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }

          if (text.length > 15_000) {
            text = text.slice(0, 15_000) + '\n\n... (truncated)';
          }
          return `[${resp.status}] ${text}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    web_search: tool({
      description: 'Search the web. Uses a search engine and returns results with titles, URLs, and snippets.',
      inputSchema: s(z.object({
        query: z.string().describe('Search query'),
        count: z.number().optional().describe('Number of results (default 5)'),
      })),
      execute: async ({ query, count }: { query: string; count?: number }) => {
        try {
          // Use DuckDuckGo lite (no API key needed)
          const encoded = encodeURIComponent(query);
          const resp = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
            headers: { 'User-Agent': 'CHAOS-TUI/1.0' },
            signal: AbortSignal.timeout(10_000),
          });
          const html = await resp.text();

          // Parse results from DDG lite HTML
          const results: string[] = [];
          const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
          const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

          let linkMatch;
          const links: Array<{ url: string; title: string }> = [];
          while ((linkMatch = linkRegex.exec(html)) !== null) {
            links.push({ url: linkMatch[1]!, title: linkMatch[2]!.trim() });
          }

          let snippetMatch;
          const snippets: string[] = [];
          while ((snippetMatch = snippetRegex.exec(html)) !== null) {
            snippets.push(snippetMatch[1]!.replace(/<[^>]+>/g, '').trim());
          }

          const max = count || 5;
          for (let i = 0; i < Math.min(links.length, max); i++) {
            const link = links[i]!;
            const snippet = snippets[i] || '';
            results.push(`${i + 1}. ${link.title}\n   ${link.url}\n   ${snippet}`);
          }

          return results.length > 0 ? results.join('\n\n') : '(no results found)';
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  };
}

/**
 * System discovery tools — find available commands and tools on the system.
 */
export function createSystemTools(): ToolSet {
  return {
    find_command: tool({
      description: 'Check if a command-line tool is available on the system. Returns its path and version if found.',
      inputSchema: s(z.object({
        name: z.string().describe('Command name to look for (e.g. "curl", "python", "docker", "ffmpeg")'),
      })),
      execute: async ({ name }: { name: string }) => {
        try {
          const whichResult = child_process.execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8', timeout: 5_000 }).trim();
          let version = '';
          try {
            version = child_process.execSync(`${name} --version 2>&1 | head -1`, { encoding: 'utf-8', timeout: 5_000 }).trim();
          } catch {
            // Some commands don't support --version
          }
          return `Found: ${whichResult}${version ? `\nVersion: ${version}` : ''}`;
        } catch {
          return `Command '${name}' not found on this system.`;
        }
      },
    }),

    list_system_tools: tool({
      description: 'List commonly available command-line tools on this system. Checks for categories of tools.',
      inputSchema: s(z.object({
        category: z.enum(['all', 'dev', 'web', 'media', 'data', 'system']).optional()
          .describe('Category to check (default: all)'),
      })),
      execute: async ({ category }: { category?: string }) => {
        const checks: Record<string, string[]> = {
          dev: ['git', 'node', 'npm', 'npx', 'python3', 'python', 'pip', 'cargo', 'go', 'java', 'gcc', 'make', 'cmake', 'docker', 'deno', 'bun'],
          web: ['curl', 'wget', 'httpie', 'chromium', 'google-chrome', 'firefox'],
          media: ['ffmpeg', 'ffprobe', 'convert', 'identify', 'sox', 'inkscape'],
          data: ['jq', 'yq', 'sqlite3', 'psql', 'mysql', 'redis-cli', 'mongosh'],
          system: ['tar', 'zip', 'unzip', 'gzip', 'ssh', 'rsync', 'tmux', 'screen', 'htop', 'lsof', 'strace'],
        };

        const cats = category && category !== 'all' ? [category] : Object.keys(checks);
        const results: string[] = [];

        for (const cat of cats) {
          const tools = checks[cat] || [];
          const found: string[] = [];
          for (const t of tools) {
            try {
              child_process.execSync(`which ${t} 2>/dev/null`, { encoding: 'utf-8', timeout: 2_000 });
              found.push(t);
            } catch {
              // not found
            }
          }
          if (found.length > 0) {
            results.push(`${cat}: ${found.join(', ')}`);
          }
        }

        return results.length > 0 ? results.join('\n') : '(no common tools found)';
      },
    }),
  };
}

