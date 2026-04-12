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
    local_fetch: tool({
      description: 'Fetch a URL using local network (fallback). Use the provider web_fetch/url_context tool first — only use this if the provider tool is unavailable or blocked.',
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

    local_web_search: tool({
      description: 'Search the web using DuckDuckGo (fallback). Use the provider web_search/google_search tool first — only use this if the provider search is unavailable.',
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

/**
 * Schedule tools — agents can create recurring tasks.
 */
/**
 * Hook tools — agents can create OS-level event hooks.
 */
/**
 * Channel tools — agents can send messages to external channels.
 */
export function createChannelTools(agentId: string): ToolSet {
  return {
    channel_send: tool({
      description: 'Send a message to an external channel (Telegram, Discord, Email, Webhook). Use this to proactively reach out through connected channels.',
      inputSchema: s(z.object({
        channelId: z.string().optional().describe('Channel ID to send to (use channel_list to find)'),
        channelType: z.string().optional().describe('Filter by type: telegram, discord, email, webhook'),
        content: z.string().describe('Message content to send'),
      })),
      execute: async ({ channelId, channelType, content }: { channelId?: string; channelType?: string; content: string }) => {
        const { loadChannelConfigs, getChannelsSDK } = await import('./channels.js');
        const sdk = getChannelsSDK();
        if (!sdk) return 'Error: Relay not configured. Use Ctrl+J to set up channels.';

        const channels = loadChannelConfigs();
        const target = channelId
          ? channels.find(c => c.id === channelId)
          : channels.find(c => (!channelType || c.type === channelType) && c.direction === 'bidirectional');

        if (!target) return `Error: No matching channel found. Available: ${channels.map(c => `${c.name || c.id} (${c.type})`).join(', ') || 'none'}`;

        try {
          await sdk.channels.reply({ channelType: target.type, channelId: target.id, content });
          return `Sent to ${target.name || target.id} (${target.type})`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    channel_list: tool({
      description: 'List all configured external channels (Telegram, Discord, Email, Webhook).',
      inputSchema: s(z.object({})),
      execute: async () => {
        const { loadChannelConfigs } = await import('./channels.js');
        const channels = loadChannelConfigs();
        if (channels.length === 0) return 'No channels configured.';
        return channels.map(c =>
          `[${c.enabled ? 'ON' : 'OFF'}] ${c.name || c.id} — ${c.type} (${c.direction}, agent: ${c.agentId})`
        ).join('\n');
      },
    }),
  };
}

export function createHookTools(agentId: string): ToolSet {
  return {
    hook_create: tool({
      description: 'Create a hook that triggers this agent when an OS event occurs. Supports: file-changed, directory-changed, git-commit, git-branch-switch, env-changed, url-changed, cron.',
      inputSchema: s(z.object({
        triggerType: z.enum(['file-changed', 'directory-changed', 'git-commit', 'git-branch-switch', 'env-changed', 'url-changed', 'cron']),
        path: z.string().optional().describe('File or directory path (for file/directory/env triggers)'),
        url: z.string().optional().describe('URL to monitor (for url-changed)'),
        intervalMinutes: z.number().optional().describe('Poll interval in minutes (for url-changed and cron)'),
        glob: z.string().optional().describe('File pattern filter (for directory-changed, e.g. "*.ts")'),
        prompt: z.string().describe('What to do when the hook fires'),
        description: z.string().describe('Human-readable description'),
      })),
      execute: async ({ triggerType, path: triggerPath, url, intervalMinutes, glob, prompt, description }: {
        triggerType: string; path?: string; url?: string; intervalMinutes?: number; glob?: string; prompt: string; description: string;
      }) => {
        const { addHook: addH, startSingleHook } = await import('./hooks.js');
        const hook = addH({
          agentId,
          trigger: { type: triggerType as import('./hooks.js').HookTriggerType, path: triggerPath, url, intervalMinutes, glob },
          prompt,
          description,
        });
        // Note: startSingleHook needs the callback which is set up in App.tsx
        // The hook will start on next TUI restart, or when the engine picks it up
        return `Hook created: "${description}" (trigger: ${triggerType}, id: ${hook.id})`;
      },
    }),

    hook_list: tool({
      description: 'List all hooks for this agent.',
      inputSchema: s(z.object({})),
      execute: async () => {
        const { loadHooks: loadH } = await import('./hooks.js');
        const all = loadH().filter((h: { agentId: string }) => h.agentId === agentId);
        if (all.length === 0) return 'No hooks configured.';
        return all.map((h: { enabled: boolean; description: string; trigger: { type: string }; id: string; triggerCount: number; lastTriggeredAt?: string }) =>
          `[${h.enabled ? 'ON' : 'OFF'}] ${h.description} (${h.trigger.type}, id: ${h.id}, fired: ${h.triggerCount}x, last: ${h.lastTriggeredAt || 'never'})`
        ).join('\n');
      },
    }),

    hook_delete: tool({
      description: 'Delete a hook by its ID.',
      inputSchema: s(z.object({
        id: z.string().describe('Hook ID to delete'),
      })),
      execute: async ({ id }: { id: string }) => {
        const { removeHook: removeH } = await import('./hooks.js');
        removeH(id);
        return `Deleted hook ${id}`;
      },
    }),
  };
}

export function createScheduleTools(agentId: string): ToolSet {
  return {
    schedule_task: tool({
      description: 'Schedule a recurring task. The task will run at the specified interval while the TUI is open. Each run opens a new conversation column.',
      inputSchema: s(z.object({
        prompt: z.string().describe('What to do each time the task runs'),
        description: z.string().describe('Short human-readable description'),
        intervalMinutes: z.number().describe('How often to run, in minutes (e.g. 60 for hourly, 1440 for daily)'),
      })),
      execute: async ({ prompt, description, intervalMinutes }: { prompt: string; description: string; intervalMinutes: number }) => {
        const { addSchedule } = await import('./scheduler.js');
        const task = addSchedule({ agentId, prompt, description, intervalMinutes });
        return `Scheduled: "${description}" every ${intervalMinutes} minutes (id: ${task.id})`;
      },
    }),

    list_schedules: tool({
      description: 'List all scheduled tasks for this agent.',
      inputSchema: s(z.object({})),
      execute: async () => {
        const { loadSchedules } = await import('./scheduler.js');
        const all = loadSchedules().filter((t: { agentId: string }) => t.agentId === agentId);
        if (all.length === 0) return 'No scheduled tasks.';
        return all.map((t: { enabled: boolean; description: string; intervalMinutes: number; id: string; lastRunAt?: string }) =>
          `[${t.enabled ? 'ON' : 'OFF'}] ${t.description} — every ${t.intervalMinutes}min (id: ${t.id}, last: ${t.lastRunAt || 'never'})`
        ).join('\n');
      },
    }),

    cancel_schedule: tool({
      description: 'Cancel a scheduled task by its ID.',
      inputSchema: s(z.object({
        id: z.string().describe('Schedule ID to cancel'),
      })),
      execute: async ({ id }: { id: string }) => {
        const { removeSchedule } = await import('./scheduler.js');
        removeSchedule(id);
        return `Cancelled schedule ${id}`;
      },
    }),
  };
}

