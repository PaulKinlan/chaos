/**
 * Agentic Loop
 *
 * A multi-step autonomous agent loop. Unlike the single-turn chat loop,
 * this keeps calling the LLM until it decides the task is complete
 * (i.e. responds with text and no tool calls). Designed for scheduled
 * tasks, hooks, context menu actions, and complex multi-step requests.
 *
 * Uses generateText (not streamText) per step so we can inspect the
 * full response and decide whether to continue. Progress updates are
 * streamed to the caller via the onProgress callback.
 */

import { streamText, stepCountIs, tool, type ToolSet, type ModelMessage } from 'ai';
import { z } from 'zod';
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
import { recordUsage } from './usage.js';

// ── Types ──

export interface ProgressUpdate {
  type: 'thinking' | 'tool-call' | 'tool-result' | 'text' | 'step-complete' | 'done' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  iteration?: number;
  totalIterations?: number;
}

export interface AgenticLoopOptions {
  agentId: string;
  task: string;
  pageContext?: { title: string; url: string; content: string };
  onProgress?: (update: ProgressUpdate) => void;
  maxIterations?: number;
  signal?: AbortSignal;
  /** What triggered this loop — used for usage tracking. */
  source?: 'chat' | 'hook' | 'channel' | 'task' | 'message';
}

// ── Constants ──

const AGENTS_ROOT = 'agents';
const ACTIVITY_LOG = 'activity-log.jsonl';
const JOURNAL_LINES = 30;
const DEFAULT_MAX_ITERATIONS = 20;
const INNER_MAX_STEPS = 5;

// ── Permission-wrapped tools ──

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

// ── Tool filtering by agent config ──

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

// ── Agent file tools (same as loop.ts) ──

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

// ── Build system prompt ──

async function buildAgenticSystemPrompt(
  agentId: string,
  claudeMd: string,
  pageContext?: AgenticLoopOptions['pageContext'],
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
      console.log(`[agentic-loop] Agent ${agentId} loaded ${skillsList.length} skill(s): ${loadedSkillNames.join(', ')}`);
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

// ── Shared message reading ──

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

// ── Activity log ──

interface ActivityLogEntry {
  timestamp: string;
  role: 'user' | 'assistant';
  summary: string;
  toolCalls?: string[];
}

async function appendActivityLog(agentId: string, entry: ActivityLogEntry): Promise<void> {
  const logPath = `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`;
  await opfs.appendFile(logPath, JSON.stringify(entry) + '\n');
}

// ── Main agentic loop ──

/**
 * Run an autonomous agentic loop. The agent keeps calling tools and
 * reasoning until it decides the task is complete (responds with text
 * only, no tool calls), or hits the max iteration limit.
 */
export async function runAgenticLoop(options: AgenticLoopOptions): Promise<string> {
  const {
    agentId,
    task,
    pageContext,
    onProgress,
    signal,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  // 1. Load agent CLAUDE.md
  const claudeMdPath = `${AGENTS_ROOT}/${agentId}/CLAUDE.md`;
  let claudeMd: string;
  try {
    claudeMd = await opfs.readFile(claudeMdPath);
  } catch {
    throw new Error(`Agent not found or missing CLAUDE.md: ${agentId}`);
  }

  // 2. Build system prompt
  const { prompt: systemPrompt, skillNames } = await buildAgenticSystemPrompt(agentId, claudeMd, pageContext);

  // Report loaded skills to the UI
  if (skillNames.length > 0 && onProgress) {
    onProgress({
      type: 'thinking',
      content: `Loaded skills: ${skillNames.join(', ')}`,
      iteration: 0,
      totalIterations: maxIterations,
    });
  }

  // 3. Get provider configuration (agent override -> global settings)
  const modelConfig = await getAgentModelConfig(agentId);
  const model = createLanguageModel(modelConfig.provider, modelConfig.apiKey, modelConfig.model);

  // 4. Build tools
  const agents = await getAgentList();
  const apiKeys = await getApiKeys();
  const selfMeta = agents.find((a) => a.id === agentId);
  const isVisible = selfMeta && selfMeta.visibility !== 'private';

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

  let tools = filterToolsByConfig(unfilteredTools, selfMeta);
  tools = wrapToolsWithPermissions(tools);

  // 5. Log start
  await appendActivityLog(agentId, {
    timestamp: new Date().toISOString(),
    role: 'user',
    summary: `[Agentic] ${task.slice(0, 200)}`,
  });

  // 6. Build message history (starts with user task)
  const messages: ModelMessage[] = [{ role: 'user', content: task }];

  // 7. Agentic loop
  let lastText = '';
  const allToolCallNames: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    // Check abort signal
    if (signal?.aborted) {
      onProgress?.({ type: 'error', content: 'Aborted', iteration: i + 1, totalIterations: maxIterations });
      break;
    }

    onProgress?.({
      type: 'thinking',
      content: `Step ${i + 1}...`,
      iteration: i + 1,
      totalIterations: maxIterations,
    });

    // Stream LLM response - stream text in real-time, collect tool calls
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(INNER_MAX_STEPS),
      abortSignal: signal,
    });

    // Consume the stream: text deltas streamed live, tool calls collected
    const iterationToolCalls: { toolName: string; args: unknown }[] = [];
    let iterationText = '';

    for await (const part of result.fullStream) {
      if (signal?.aborted) break;

      switch (part.type) {
        case 'text-delta':
          iterationText += part.text;
          // Stream text chunks to the UI in real-time
          onProgress?.({
            type: 'thinking',
            content: part.text,
            iteration: i + 1,
            totalIterations: maxIterations,
          });
          break;

        case 'tool-call': {
          const toolArgs = 'args' in part ? part.args : ('input' in part ? (part as any).input : undefined);
          iterationToolCalls.push({ toolName: part.toolName, args: toolArgs });
          allToolCallNames.push(part.toolName);
          onProgress?.({
            type: 'tool-call',
            content: `Called ${part.toolName}`,
            toolName: part.toolName,
            toolArgs,
            iteration: i + 1,
            totalIterations: maxIterations,
          });
          break;
        }

        case 'tool-result':
          // Tool result from inner step
          onProgress?.({
            type: 'tool-result',
            content: '',
            toolName: part.toolName,
            toolResult: 'result' in part ? part.result : ('output' in part ? (part as any).output : undefined),
            iteration: i + 1,
            totalIterations: maxIterations,
          });
          break;
      }
    }

    const hasToolCalls = iterationToolCalls.length > 0;

    // Report complete text for this step (if not already streamed piecemeal)
    lastText = iterationText;
    if (iterationText) {
      onProgress?.({
        type: 'text',
        content: iterationText,
        iteration: i + 1,
        totalIterations: maxIterations,
      });
    }

    onProgress?.({
      type: 'step-complete',
      content: `Step ${i + 1} complete`,
      iteration: i + 1,
      totalIterations: maxIterations,
    });

    // Append the response messages to our conversation history
    // so the next iteration sees the full context
    const response = await result.response;
    for (const msg of response.messages) {
      messages.push(msg as ModelMessage);
    }

    // Get the final text for this iteration
    const finalText = await result.text;
    lastText = finalText || iterationText;

    // Record token usage for this iteration
    try {
      const usage = await result.totalUsage;
      await recordUsage({
        agentId,
        agentName: selfMeta?.name || agentId,
        provider: modelConfig.provider,
        model: modelConfig.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        source: options.source || 'chat',
      });
    } catch (err) {
      console.warn('[usage] Failed to record agentic loop usage:', err);
    }

    // If no tool calls were made, the agent considers itself done
    if (!hasToolCalls) {
      const doneText = lastText;
      onProgress?.({
        type: 'done',
        content: doneText,
        iteration: i + 1,
        totalIterations: maxIterations,
      });

      // Log completion
      await appendActivityLog(agentId, {
        timestamp: new Date().toISOString(),
        role: 'assistant',
        summary: `[Agentic] ${doneText.slice(0, 200)}`,
        toolCalls: allToolCallNames.length > 0 ? allToolCallNames : undefined,
      });

      return doneText;
    }

    // Otherwise, add a user message prompting the agent to continue
    messages.push({
      role: 'user',
      content: 'Continue working on the task. If you are done, respond with your final summary without calling any tools.',
    });
  }

  // Hit max iterations
  onProgress?.({
    type: 'error',
    content: `Reached maximum ${maxIterations} iterations`,
    iteration: maxIterations,
    totalIterations: maxIterations,
  });

  // Log the max-iteration outcome
  await appendActivityLog(agentId, {
    timestamp: new Date().toISOString(),
    role: 'assistant',
    summary: `[Agentic] Hit max iterations (${maxIterations}). Last: ${lastText.slice(0, 150)}`,
    toolCalls: allToolCallNames.length > 0 ? allToolCallNames : undefined,
  });

  return lastText;
}
