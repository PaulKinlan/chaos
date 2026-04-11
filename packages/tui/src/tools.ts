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
