/**
 * OS-level tools for the TUI agent.
 * Provides filesystem access, shell execution, and directory browsing
 * scoped to the current working directory.
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

export function createOsTools(): ToolSet {
  return {
    read_file: tool({
      description: 'Read a file from the current directory.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to cwd'),
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

    write_file: tool({
      description: 'Write content to a file in the current directory.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to cwd'),
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

    list_directory: tool({
      description: 'List files and directories in a path.',
      inputSchema: s(z.object({
        path: z.string().optional().describe('Directory path relative to cwd (default: ".")'),
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

    run_command: tool({
      description: 'Run a shell command in the current directory. Use for git, npm, grep, etc.',
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

    search_files: tool({
      description: 'Search file contents for a pattern using grep.',
      inputSchema: s(z.object({
        pattern: z.string().describe('Search pattern (regex)'),
        glob: z.string().optional().describe('File glob to search in (e.g. "**/*.ts")'),
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

    file_info: tool({
      description: 'Get metadata about a file: size, modified time, type.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to cwd'),
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
            created: stat.birthtime.toISOString(),
          }, null, 2);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    edit_file: tool({
      description: 'Edit a file by replacing an exact string match.',
      inputSchema: s(z.object({
        path: z.string().describe('File path relative to cwd'),
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

    watch_directory: tool({
      description: 'Get a snapshot of recent file changes in the current directory (last modified files).',
      inputSchema: s(z.object({
        count: z.number().optional().describe('Number of recent files to show (default 10)'),
      })),
      execute: async ({ count }: { count?: number }) => {
        try {
          const result = child_process.execSync(
            `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%T@ %p\\n' | sort -rn | head -${count || 10}`,
            { cwd: CWD, encoding: 'utf-8', timeout: 10_000 },
          );
          const lines = result.trim().split('\n').map((line) => {
            const [ts, ...pathParts] = line.split(' ');
            const date = new Date(parseFloat(ts!) * 1000);
            return `${date.toISOString().slice(0, 19)} ${pathParts.join(' ')}`;
          });
          return lines.join('\n') || '(no files)';
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  };
}
