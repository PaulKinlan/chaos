/**
 * Provider-native tools — built-in tools from each AI SDK provider.
 *
 * Server-side tools (no execute needed): web search, code execution, etc.
 * Local tools (execute callback): bash, text editor, memory — we implement
 * the execute functions using Node.js APIs.
 */

import type { ToolSet } from 'ai';
import type { ProviderId } from './model.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

const CWD = process.cwd();

export async function getProviderTools(provider: ProviderId, agentId?: string): Promise<ToolSet> {
  const tools: ToolSet = {};

  try {
    switch (provider) {
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

        // Server-side tools (no execute needed)
        tools.web_search = anthropic.tools.webSearch_20260209();
        tools.web_fetch = anthropic.tools.webFetch_20260209();
        tools.code_execution = anthropic.tools.codeExecution_20260120();

        // Bash tool — Claude generates commands, we execute them locally
        tools.bash = anthropic.tools.bash_20250124({
          execute: async ({ command }: { command: string; restart?: boolean }) => {
            try {
              const result = child_process.execSync(command, {
                cwd: CWD,
                timeout: 30_000,
                maxBuffer: 2 * 1024 * 1024,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
              });
              return result.toString();
            } catch (err: unknown) {
              const e = err as { stderr?: string; stdout?: string; message?: string };
              return `${e.stdout || ''}${e.stderr || e.message || String(err)}`;
            }
          },
        });

        // Text editor tool — Claude generates file edits, we apply them
        tools.str_replace_based_edit_tool = anthropic.tools.textEditor_20250728({
          execute: async ({ command, path: filePath, old_str, new_str, insert_text }: {
            command: string; path: string; old_str?: string; new_str?: string; insert_text?: string;
          }) => {
            const full = path.resolve(CWD, filePath);
            switch (command) {
              case 'view': {
                if (!fs.existsSync(full)) return `Error: ${filePath} not found`;
                const content = fs.readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                return lines.map((l, i) => `${String(i + 1).padStart(4)}\t${l}`).join('\n');
              }
              case 'create': {
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, insert_text || '', 'utf-8');
                return `Created ${filePath}`;
              }
              case 'str_replace': {
                if (!fs.existsSync(full)) return `Error: ${filePath} not found`;
                const content = fs.readFileSync(full, 'utf-8');
                if (!old_str || !content.includes(old_str)) return `Error: old_str not found in ${filePath}`;
                fs.writeFileSync(full, content.replace(old_str, new_str || ''), 'utf-8');
                return `Replaced in ${filePath}`;
              }
              case 'insert': {
                if (!fs.existsSync(full)) return `Error: ${filePath} not found`;
                const content = fs.readFileSync(full, 'utf-8');
                fs.writeFileSync(full, content + (insert_text || ''), 'utf-8');
                return `Inserted into ${filePath}`;
              }
              default:
                return `Unknown command: ${command}`;
            }
          },
        });

        // Memory tool — Claude manages persistent memory
        if (agentId) {
          const memDir = path.resolve(CWD, '.chaos', agentId, 'memories');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools.memory = anthropic.tools.memory_20250818({
            execute: async (action: any) => {
              fs.mkdirSync(memDir, { recursive: true });
              const memFile = path.join(memDir, 'claude-memory.json');
              let store: Record<string, string> = {};
              if (fs.existsSync(memFile)) {
                try { store = JSON.parse(fs.readFileSync(memFile, 'utf-8')); } catch { /* */ }
              }

              const cmd = action.command || action.type || '';
              const key = action.key || action.name || '';
              const value = action.value || action.content || '';

              switch (cmd) {
                case 'get': case 'read':
                  return key ? (store[key] || '(not found)') : JSON.stringify(store);
                case 'set': case 'write': case 'save':
                  if (key) store[key] = value;
                  fs.writeFileSync(memFile, JSON.stringify(store, null, 2), 'utf-8');
                  return `Saved ${key}`;
                case 'delete': case 'remove':
                  if (key) delete store[key];
                  fs.writeFileSync(memFile, JSON.stringify(store, null, 2), 'utf-8');
                  return `Deleted ${key}`;
                case 'list': case 'keys':
                  return Object.keys(store).join(', ') || '(empty)';
                default:
                  return JSON.stringify(store);
              }
            },
          } as any);
        }

        console.log('[provider-tools] Anthropic: web_search, web_fetch, code_execution, bash, text_editor, memory');
        break;
      }

      case 'openai': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

        // Server-side
        tools.web_search = openai.tools.webSearch();

        // Local shell — OpenAI generates commands, we execute locally
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools.local_shell = openai.tools.localShell({
          execute: async (input: any) => {
            try {
              const cmd = Array.isArray(input.command) ? input.command.join(' ')
                : (input.action?.command ? input.action.command.join(' ') : String(input));
              const result = child_process.execSync(cmd, {
                cwd: CWD,
                timeout: 30_000,
                maxBuffer: 2 * 1024 * 1024,
                encoding: 'utf-8',
              });
              return result.toString();
            } catch (err: unknown) {
              const e = err as { stderr?: string; message?: string };
              return e.stderr || e.message || String(err);
            }
          },
        } as any);

        console.log('[provider-tools] OpenAI: web_search, local_shell');
        break;
      }

      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || '' });

        // All server-side
        tools.google_search = google.tools.googleSearch({});
        tools.code_execution = google.tools.codeExecution({});
        tools.url_context = google.tools.urlContext({});

        console.log('[provider-tools] Google: google_search, code_execution, url_context');
        break;
      }

      case 'openrouter':
      case 'ollama':
        break;
    }
  } catch (err) {
    console.warn(`[provider-tools] Failed to load ${provider} tools:`, err);
  }

  return tools;
}
