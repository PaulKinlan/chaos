/**
 * Extension Agent Adapter
 *
 * Bridges the Chrome extension's tools, system prompt, and storage
 * with @chaos/agent-loop's createAgent/streamAgentLoop.
 *
 * All Chrome-specific code stays here; the loop engine comes from
 * the shared agent-loop package.
 */

import { createAgent } from '@chaos/agent-loop';
import type { Agent, ProgressEvent, AgentConfig } from '@chaos/agent-loop';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { tool } from 'ai';

import { opfs } from '../storage/opfs.js';
import { getAgentList, getApiKeys } from '../storage/chrome-storage.js';
import { createLanguageModel, getProviderSearchTools } from './provider-registry.js';
import { getAgentModelConfig } from './model-config.js';
import { getCommunicationTools } from '../tools/communication/index.js';
import { getChromeTools } from '../tools/chrome/index.js';
import { getWasmTools } from '../tools/wasm/index.js';
import { getWebTools } from '../tools/web/index.js';
import { getHookTools } from '../tools/hooks/index.js';
import { getMasterTools } from '../tools/master/index.js';
import { getSkillTools } from '../tools/skills/index.js';
import type { AgentMeta } from '../storage/types.js';
import { checkPermission } from '../tools/permissions.js';
import { buildSkillsPromptSection } from './skills.js';
import { recordUsage, checkSpendingLimit } from './usage.js';

// ProgressUpdate type — previously in agentic-loop.ts, now defined here
export interface ProgressUpdate {
  type: 'thinking' | 'tool-call' | 'tool-result' | 'text' | 'step-complete' | 'done' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  iteration?: number;
  totalIterations?: number;
}

// ── Constants ──

const AGENTS_ROOT = 'agents';
const ACTIVITY_LOG = 'activity-log.jsonl';
const JOURNAL_LINES = 30;
const DEFAULT_MAX_ITERATIONS = 20;
const INNER_MAX_STEPS = 5;

// ── Permission-wrapped tools (copied from agentic-loop.ts) ──

function wrapToolsWithPermissions(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const originalExecute = t.execute;
    if (!originalExecute) {
      wrapped[name] = t;
      continue;
    }
    const exec = originalExecute;
    wrapped[name] = {
      ...t,
      execute: async (...args: Parameters<typeof exec>) => {
        const allowed = await checkPermission(name);
        if (!allowed) {
          return `Error: Permission denied for tool "${name}". This tool is set to "never" in your permissions.`;
        }
        return exec(...args);
      },
    } as typeof t;
  }
  return wrapped;
}

// ── Tool filtering by agent config (copied from agentic-loop.ts) ──

const MINIMUM_TOOLS = ['read_file', 'list_directory'];

function filterToolsByConfig(tools: ToolSet, agentMeta?: AgentMeta): ToolSet {
  if (!agentMeta) return tools;
  const { enabledTools, disabledTools } = agentMeta;
  if (!enabledTools && !disabledTools) return tools;

  const filtered: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    if (MINIMUM_TOOLS.includes(name)) {
      filtered[name] = t;
      continue;
    }
    if (enabledTools && enabledTools.length > 0) {
      if (!enabledTools.includes(name)) continue;
    }
    if (disabledTools && disabledTools.length > 0) {
      if (disabledTools.includes(name)) continue;
    }
    filtered[name] = t;
  }
  return filtered;
}

// ── Agent file tools (copied from agentic-loop.ts) ──

function createAgentTools(agentId: string): ToolSet {
  const agentRoot = `${AGENTS_ROOT}/${agentId}`;

  return {
    read_file: tool({
      description:
        'Read a file from your private storage. Path is relative to your agent root directory.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to agent root'),
      }),
      execute: async ({ path }) => {
        try {
          return await opfs.readFile(`${agentRoot}/${path}`);
        } catch {
          return `Error: File not found: ${path}`;
        }
      },
    }),

    write_file: tool({
      description:
        'Write content to a file in your private storage. Creates the file and parent directories if they do not exist.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to agent root'),
        content: z.string().describe('File content to write'),
      }),
      execute: async ({ path, content }) => {
        await opfs.writeFile(`${agentRoot}/${path}`, content);
        return `Written: ${path}`;
      },
    }),

    list_directory: tool({
      description:
        'List files and directories in a directory in your private storage.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Directory path relative to agent root'),
      }),
      execute: async ({ path }) => {
        try {
          const dirPath = path === '.' ? agentRoot : `${agentRoot}/${path}`;
          const entries = await opfs.listDir(dirPath);
          return entries.join('\n') || '(empty directory)';
        } catch {
          return `Error: Directory not found: ${path}`;
        }
      },
    }),

    edit_file: tool({
      description:
        'Edit a file by replacing an exact string match.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to agent root'),
        old_string: z.string().describe('Exact string to find and replace'),
        new_string: z.string().describe('Replacement string'),
      }),
      execute: async ({ path, old_string, new_string }) => {
        try {
          const filePath = `${agentRoot}/${path}`;
          const content = await opfs.readFile(filePath);
          if (!content.includes(old_string)) {
            return `Error: String not found in ${path}`;
          }
          const updated = content.replace(old_string, new_string);
          await opfs.writeFile(filePath, updated);
          return `Edited: ${path}`;
        } catch {
          return `Error: Could not edit ${path}`;
        }
      },
    }),

    mkdir: tool({
      description: 'Create a directory in your private storage.',
      inputSchema: z.object({
        path: z.string().describe('Directory path relative to agent root'),
      }),
      execute: async ({ path }) => {
        await opfs.mkdir(`${agentRoot}/${path}`);
        return `Created directory: ${path}`;
      },
    }),

    append_file: tool({
      description: 'Append content to a file. Creates the file if it does not exist.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to agent root'),
        content: z.string().describe('Content to append'),
      }),
      execute: async ({ path, content }) => {
        await opfs.appendFile(`${agentRoot}/${path}`, content);
        return `Appended to: ${path}`;
      },
    }),

    grep_file: tool({
      description:
        'Search file contents for a text pattern. Returns matching lines with line numbers.',
      inputSchema: z.object({
        pattern: z.string().describe('Text pattern to search for'),
        path: z.string().default('.').describe('File or directory path relative to agent root'),
      }),
      execute: async ({ pattern, path }) => {
        const fullPath = path === '.' ? agentRoot : `${agentRoot}/${path}`;
        const results: string[] = [];
        const MAX_MATCHES = 50;

        async function searchFile(filePath: string, displayPath: string): Promise<void> {
          try {
            const content = await opfs.readFile(filePath);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < MAX_MATCHES; i++) {
              if (lines[i].includes(pattern)) {
                results.push(`${displayPath}:${i + 1}:${lines[i]}`);
              }
            }
          } catch {
            // Skip
          }
        }

        async function searchDir(dirPath: string, displayPrefix: string): Promise<void> {
          try {
            const entries = await opfs.listDir(dirPath);
            for (const entry of entries) {
              if (results.length >= MAX_MATCHES) break;
              const childPath = `${dirPath}/${entry}`;
              const childDisplay = displayPrefix ? `${displayPrefix}/${entry}` : entry;
              try {
                await opfs.readFile(childPath);
                await searchFile(childPath, childDisplay);
              } catch {
                try {
                  await opfs.listDir(childPath);
                  await searchDir(childPath, childDisplay);
                } catch {
                  // Skip
                }
              }
            }
          } catch {
            // Skip
          }
        }

        try {
          const content = await opfs.readFile(fullPath);
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < MAX_MATCHES; i++) {
            if (lines[i].includes(pattern)) {
              results.push(`${i + 1}:${lines[i]}`);
            }
          }
        } catch {
          await searchDir(fullPath, '');
        }

        if (results.length === 0) return `No matches found for "${pattern}"`;
        const suffix = results.length >= MAX_MATCHES ? `\n(limited to ${MAX_MATCHES} matches)` : '';
        return results.join('\n') + suffix;
      },
    }),

    find_files: tool({
      description: 'Find files by name pattern. Returns matching file paths.',
      inputSchema: z.object({
        pattern: z.string().describe('File name pattern (e.g. "*.md", "TODO*")'),
        path: z.string().default('.').describe('Directory path relative to agent root'),
      }),
      execute: async ({ pattern, path }) => {
        const fullPath = path === '.' ? agentRoot : `${agentRoot}/${path}`;
        const matches: string[] = [];
        const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        const regex = new RegExp(regexStr);

        async function walk(dirPath: string, displayPrefix: string): Promise<void> {
          try {
            const entries = await opfs.listDir(dirPath);
            for (const entry of entries) {
              const childPath = `${dirPath}/${entry}`;
              const childDisplay = displayPrefix ? `${displayPrefix}/${entry}` : entry;
              if (regex.test(entry)) matches.push(childDisplay);
              try {
                await opfs.listDir(childPath);
                await walk(childPath, childDisplay);
              } catch {
                // Not a directory
              }
            }
          } catch {
            // Skip
          }
        }

        await walk(fullPath, '');
        if (matches.length === 0) return `No files matching "${pattern}" found`;
        return matches.join('\n');
      },
    }),

    delete_file: tool({
      description: 'Delete a file from your private storage. Cannot delete CLAUDE.md.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to agent root'),
      }),
      execute: async ({ path }) => {
        if (path === 'CLAUDE.md' || path === './CLAUDE.md') {
          return 'Error: Cannot delete CLAUDE.md — this file is protected.';
        }
        try {
          await opfs.delete(`${agentRoot}/${path}`);
          return `Deleted: ${path}`;
        } catch {
          return `Error: Could not delete ${path} (file may not exist)`;
        }
      },
    }),

    rename_file: tool({
      description: 'Rename or move a file within your private storage.',
      inputSchema: z.object({
        oldPath: z.string().describe('Current file path relative to agent root'),
        newPath: z.string().describe('New file path relative to agent root'),
      }),
      execute: async ({ oldPath, newPath }) => {
        try {
          const content = await opfs.readFile(`${agentRoot}/${oldPath}`);
          await opfs.writeFile(`${agentRoot}/${newPath}`, content);
          await opfs.delete(`${agentRoot}/${oldPath}`);
          return `Renamed: ${oldPath} → ${newPath}`;
        } catch {
          return `Error: Could not rename ${oldPath} to ${newPath}`;
        }
      },
    }),

    file_info: tool({
      description: 'Get metadata about a file or directory.',
      inputSchema: z.object({
        path: z.string().describe('File or directory path relative to agent root'),
      }),
      execute: async ({ path }) => {
        const fullPath = `${agentRoot}/${path}`;
        const fileExists = await opfs.exists(fullPath);
        if (!fileExists) return JSON.stringify({ exists: false, path });
        try {
          const content = await opfs.readFile(fullPath);
          return JSON.stringify({ exists: true, path, type: 'file', size: content.length });
        } catch {
          try {
            const entries = await opfs.listDir(fullPath);
            return JSON.stringify({ exists: true, path, type: 'directory', entries: entries.length });
          } catch {
            return JSON.stringify({ exists: true, path, type: 'unknown' });
          }
        }
      },
    }),
  };
}

// ── Shared message reading (copied from agentic-loop.ts) ──

interface SharedMessage {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  body: string;
}

async function readPendingMessages(agentId: string): Promise<SharedMessage[]> {
  try {
    const lines = await opfs.readLines('shared/messages.jsonl');
    const messages: SharedMessage[] = [];
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as SharedMessage;
        if (msg.to === agentId || msg.to === 'broadcast') {
          messages.push(msg);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return messages.slice(-20);
  } catch {
    return [];
  }
}

// ── Activity log (copied from agentic-loop.ts) ──

interface ActivityLogEntry {
  timestamp: string;
  role: 'user' | 'assistant';
  summary: string;
  toolCalls?: string[];
}

export async function appendActivityLog(agentId: string, entry: ActivityLogEntry): Promise<void> {
  const logPath = `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`;
  await opfs.appendFile(logPath, JSON.stringify(entry) + '\n');
}

// ── Build system prompt (copied from agentic-loop.ts) ──

async function buildAgenticSystemPrompt(
  agentId: string,
  claudeMd: string,
  pageContext?: { title: string; url: string; content: string },
): Promise<{ prompt: string; skillNames: string[] }> {
  const parts: string[] = [];

  parts.push(claudeMd);

  // Installed skills
  let loadedSkillNames: string[] = [];
  try {
    const { listSkills: getSkills } = await import('./skills.js');
    const skillsList = await getSkills(agentId);
    const skillsSection = await buildSkillsPromptSection(agentId);
    if (skillsSection && skillsList.length > 0) {
      parts.push(skillsSection);
      loadedSkillNames = skillsList.map(s => s.name);
      console.log(`[extension-agent] Agent ${agentId} loaded ${skillsList.length} skill(s): ${loadedSkillNames.join(', ')}`);
    }
  } catch {
    // No skills or error reading them — continue without
  }

  // Agentic loop instruction
  parts.push(`
## Autonomous Task Mode

You are running an autonomous task. Work through it step by step.

### Planning Phase (FIRST STEP)
Before starting work on any non-trivial task:
1. **Assess what expertise this task requires** — does it need design, coding, research, writing, or domain-specific knowledge?
2. **Check your installed skills** — use \`list_skills\` to see what you already have
3. **Search for relevant skills** — if the task needs expertise you don't have, call \`search_skills\` with keywords describing what you need. If a useful skill is found, call \`auto_install_skill\` to install it before proceeding.
4. **Plan your approach** — break the task into steps, then execute

Skip the skill search for simple questions or tasks you can handle with your existing knowledge and tools.

### During Execution
At ANY point during your work, if you encounter a sub-problem that needs specialised knowledge:
- Call \`search_skills\` to find a relevant skill
- Install it with \`auto_install_skill\` if found
- The skill's instructions will be available on your next step

Don't struggle without the right knowledge — search for skills whenever you hit a gap.

### Completion
Use your tools to gather information, do analysis, and produce output.
When you have completed the task, respond with your final summary
without calling any more tools.`);

  // Recent activity journal
  try {
    const logPath = `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`;
    const lines = await opfs.readLines(logPath, JOURNAL_LINES);
    if (lines.length > 0) {
      parts.push('\n## Recent Activity\n');
      parts.push('Here are your recent activity log entries (most recent last):\n');
      parts.push('```jsonl');
      parts.push(lines.join('\n'));
      parts.push('```');
    }
  } catch {
    // No activity log yet
  }

  // Pending messages from other agents
  try {
    const agents = await getAgentList();
    const self = agents.find((a) => a.id === agentId);
    if (self && (self.visibility || 'visible') !== 'private') {
      const pendingMessages = await readPendingMessages(agentId);
      if (pendingMessages.length > 0) {
        parts.push('\n## Pending Messages from Other Agents\n');
        for (const msg of pendingMessages) {
          const sender = agents.find((a) => a.id === msg.from);
          const senderName = sender?.name ?? msg.from;
          parts.push(`- **${senderName}** (${msg.timestamp}): ${msg.body}`);
        }
      }
    }
  } catch {
    // No messages
  }

  // Page context
  if (pageContext) {
    parts.push('\n## Current Page Context\n');
    parts.push(`**Title:** ${pageContext.title}`);
    parts.push(`**URL:** ${pageContext.url}`);
    parts.push('\n**Content:**\n');
    const maxContentLength = 8000;
    const content =
      pageContext.content.length > maxContentLength
        ? pageContext.content.slice(0, maxContentLength) + '\n\n[Content truncated]'
        : pageContext.content;
    parts.push(content);
  }

  return { prompt: parts.join('\n'), skillNames: loadedSkillNames };
}

// ── Create extension agent ──

export interface CreateExtensionAgentOptions {
  task?: string;
  pageContext?: { title: string; url: string; content: string };
  maxIterations?: number;
  signal?: AbortSignal;
  source?: 'chat' | 'hook' | 'channel' | 'task' | 'message';
  onProgress?: (update: ProgressUpdate) => void;
}

/**
 * Create an Agent (from @chaos/agent-loop) configured with all
 * extension-specific tools, system prompt, and Chrome APIs.
 */
export async function createExtensionAgent(
  agentId: string,
  options?: CreateExtensionAgentOptions,
): Promise<{ agent: Agent; skillNames: string[] }> {
  // 1. Load agent CLAUDE.md
  const claudeMdPath = `${AGENTS_ROOT}/${agentId}/CLAUDE.md`;
  let claudeMd: string;
  try {
    claudeMd = await opfs.readFile(claudeMdPath);
  } catch {
    throw new Error(`Agent not found or missing CLAUDE.md: ${agentId}`);
  }

  // 2. Get model config
  const modelConfig = await getAgentModelConfig(agentId);
  const model = createLanguageModel(modelConfig.provider, modelConfig.apiKey, modelConfig.model);

  // 3. Build system prompt
  const { prompt: systemPrompt, skillNames } = await buildAgenticSystemPrompt(
    agentId,
    claudeMd,
    options?.pageContext,
  );

  // 4. Load agent metadata
  const agents = await getAgentList();
  const apiKeys = await getApiKeys();
  const selfMeta = agents.find((a) => a.id === agentId);
  const isVisible = selfMeta && selfMeta.visibility !== 'private';

  // 5. Collect all tools
  const wasmTools = await getWasmTools();
  const providerSearchTools = getProviderSearchTools(modelConfig.provider, modelConfig.apiKey);
  const isMaster = selfMeta?.master === true;
  const unfilteredTools: ToolSet = {
    ...createAgentTools(agentId),
    ...(await getChromeTools(agentId)),
    ...(isVisible ? getCommunicationTools(agentId) : {}),
    ...wasmTools,
    ...getWebTools({ braveApiKey: apiKeys.brave }),
    ...getHookTools(agentId),
    ...getMasterTools(agentId, isMaster),
    ...getSkillTools(agentId),
    ...providerSearchTools,
  };

  // 6. Filter tools by agent config
  let filteredTools = filterToolsByConfig(unfilteredTools, selfMeta);

  // 7. Wrap tools with permission checks
  filteredTools = wrapToolsWithPermissions(filteredTools);

  // 8. Log start
  await appendActivityLog(agentId, {
    timestamp: new Date().toISOString(),
    role: 'user',
    summary: `[Agentic] ${(options?.task || '').slice(0, 200)}`,
  });

  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // 9. Create the agent via @chaos/agent-loop
  const agent = createAgent({
    id: agentId,
    name: selfMeta?.name || agentId,
    model: model as AgentConfig['model'],
    systemPrompt,
    tools: filteredTools,
    maxIterations,
    innerStepLimit: INNER_MAX_STEPS,
    signal: options?.signal,
    hooks: {
      onStepStart: async (event) => {
        // Check spending limits (skip on first step)
        if (event.step > 0) {
          try {
            const check = await checkSpendingLimit(agentId);
            if (check.exceeded) {
              return {
                decision: 'stop' as const,
                reason: `Daily spending limit reached ($${check.spent!.toFixed(2)} / $${check.limit!.toFixed(2)}). Increase the limit in Agent Settings to continue.`,
              };
            }
          } catch { /* spending check is best-effort */ }
        }
        return { decision: 'continue' as const };
      },
      onUsage: async (record) => {
        await recordUsage({
          agentId,
          agentName: selfMeta?.name || agentId,
          provider: modelConfig.provider,
          model: modelConfig.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          source: options?.source || 'chat',
        });
      },
      onComplete: async (event) => {
        await appendActivityLog(agentId, {
          timestamp: new Date().toISOString(),
          role: 'assistant',
          summary: `[Agentic] ${event.result.slice(0, 200)}`,
        });
      },
    },
  });

  return { agent, skillNames };
}

/**
 * Map agent-loop ProgressEvent to extension ProgressUpdate
 */
export function mapProgressEvent(event: ProgressEvent, maxIterations: number): ProgressUpdate {
  return {
    type: event.type,
    content: event.content,
    toolName: event.toolName,
    toolArgs: event.toolArgs,
    toolResult: event.toolResult,
    iteration: (event.step ?? 0) + 1, // agent-loop is 0-indexed, UI is 1-indexed
    totalIterations: maxIterations,
  };
}
