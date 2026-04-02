/**
 * Agent Loop
 *
 * The core execution loop for an agent interaction. Reads the agent's
 * CLAUDE.md, builds context, calls the AI provider with tools, and
 * processes the response.
 */

import { streamText, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs.js';
import { getAgentList, getApiKeys, getSettings } from '../storage/chrome-storage.js';
import { createLanguageModel } from './provider-registry.js';
import { getCommunicationTools } from '../tools/communication/index.js';
import { getChromeTools } from '../tools/chrome/index.js';
import { getWasmTools } from '../tools/wasm/index.js';
import { getWebTools } from '../tools/web/index.js';
import type { AgentMeta } from '../storage/types.js';
import { createToolLookup, type LookupStrategy, type ToolMeta } from '../tools/lookup/index.js';
import { checkPermission } from '../tools/permissions.js';

// ── Types ──

export interface AgentLoopOptions {
  agentId: string;
  userMessage: string;
  pageContext?: { title: string; url: string; content: string };
  onChunk?: (chunk: string) => void;
  onToolCall?: (call: { name: string; args: unknown; result: unknown }) => void;
  /** Tool lookup strategy. 'static' includes all tools (default). */
  toolLookupStrategy?: LookupStrategy;
}

interface ActivityLogEntry {
  timestamp: string;
  role: 'user' | 'assistant';
  summary: string;
  toolCalls?: string[];
}

// ── Constants ──

const AGENTS_ROOT = 'agents';
const ACTIVITY_LOG = 'activity-log.jsonl';
const JOURNAL_LINES = 30;

// ── Permission-wrapped tools ──

/**
 * Wrap each tool's execute function to check permission before executing.
 * If permission is 'never', the tool returns an error message.
 * If permission is 'ask', it currently defaults to 'always' (see permissions.ts TODO).
 */
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

/**
 * Wrap each tool's execute function to report tool calls via a callback.
 * The callback receives the tool name, input args, and the result.
 */
function wrapToolsWithReporting(
  tools: ToolSet,
  onToolCall: (call: { name: string; args: unknown; result: unknown }) => void,
): ToolSet {
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
        const result = await exec(...args);
        onToolCall({ name, args: args[0], result });
        return result;
      },
    } as typeof t;
  }
  return wrapped;
}

// ── Tool filtering by agent config ──

/** Minimum tools every agent must have, regardless of config. */
const MINIMUM_TOOLS = ['read_file', 'list_directory'];

/**
 * Filter tools based on an agent's enabledTools/disabledTools configuration.
 * - If enabledTools is set, only those tools (plus minimum required) are included.
 * - If disabledTools is set, those tools are excluded (except minimum required).
 * - If neither is set, all tools are included.
 */
function filterToolsByConfig(tools: ToolSet, agentMeta?: AgentMeta): ToolSet {
  if (!agentMeta) return tools;

  const { enabledTools, disabledTools } = agentMeta;

  // No filtering configured
  if (!enabledTools && !disabledTools) return tools;

  const filtered: ToolSet = {};

  for (const [name, t] of Object.entries(tools)) {
    // Always include minimum required tools
    if (MINIMUM_TOOLS.includes(name)) {
      filtered[name] = t;
      continue;
    }

    // If enabledTools is set, only include tools in that list
    if (enabledTools && enabledTools.length > 0) {
      if (!enabledTools.includes(name)) continue;
    }

    // If disabledTools is set, exclude tools in that list
    if (disabledTools && disabledTools.length > 0) {
      if (disabledTools.includes(name)) continue;
    }

    filtered[name] = t;
  }

  return filtered;
}

// ── File tools for agents ──

function createAgentTools(agentId: string): ToolSet {
  const agentRoot = `${AGENTS_ROOT}/${agentId}`;

  return {
    read_file: tool({
      description:
        'Read a file from your private storage. Path is relative to your agent root directory.',
      parameters: z.object({
        path: z.string().describe('File path relative to agent root'),
      }),
      execute: async ({ path }) => {
        try {
          const content = await opfs.readFile(`${agentRoot}/${path}`);
          return content;
        } catch {
          return `Error: File not found: ${path}`;
        }
      },
    }),

    write_file: tool({
      description:
        'Write content to a file in your private storage. Creates the file and parent directories if they do not exist. Path is relative to your agent root directory.',
      parameters: z.object({
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
        'List files and directories in a directory in your private storage. Path is relative to your agent root directory.',
      parameters: z.object({
        path: z
          .string()
          .default('.')
          .describe('Directory path relative to agent root'),
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
        'Edit a file by replacing an exact string match. Useful for updating specific sections of CLAUDE.md or other files without rewriting the entire file.',
      parameters: z.object({
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
      description:
        'Create a directory (and any missing parent directories) in your private storage.',
      parameters: z.object({
        path: z.string().describe('Directory path relative to agent root'),
      }),
      execute: async ({ path }) => {
        await opfs.mkdir(`${agentRoot}/${path}`);
        return `Created directory: ${path}`;
      },
    }),

    append_file: tool({
      description:
        'Append content to a file. Creates the file if it does not exist. Useful for logs and journals.',
      parameters: z.object({
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
        'Search file contents for a text pattern. If path is a file, search that file and return matching lines with line numbers. If path is a directory (or omitted), recursively search all files and return file:line:content. Uses simple string matching (not regex). Limited to 50 matches.',
      parameters: z.object({
        pattern: z.string().describe('Text pattern to search for'),
        path: z.string().default('.').describe('File or directory path relative to agent root (defaults to root)'),
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
            // Skip files that can't be read
          }
        }

        async function searchDir(dirPath: string, displayPrefix: string): Promise<void> {
          try {
            const entries = await opfs.listDir(dirPath);
            for (const entry of entries) {
              if (results.length >= MAX_MATCHES) break;
              const childPath = `${dirPath}/${entry}`;
              const childDisplay = displayPrefix ? `${displayPrefix}/${entry}` : entry;
              // Try as file first, then as directory
              try {
                await opfs.readFile(childPath);
                await searchFile(childPath, childDisplay);
              } catch {
                // Might be a directory
                try {
                  await opfs.listDir(childPath);
                  await searchDir(childPath, childDisplay);
                } catch {
                  // Skip
                }
              }
            }
          } catch {
            // Not a directory or doesn't exist
          }
        }

        // Check if path is a file or directory
        try {
          const content = await opfs.readFile(fullPath);
          // It's a file - search it directly
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < MAX_MATCHES; i++) {
            if (lines[i].includes(pattern)) {
              results.push(`${i + 1}:${lines[i]}`);
            }
          }
        } catch {
          // Not a file, try as directory
          await searchDir(fullPath, '');
        }

        if (results.length === 0) {
          return `No matches found for "${pattern}"`;
        }
        const suffix = results.length >= MAX_MATCHES ? `\n(limited to ${MAX_MATCHES} matches)` : '';
        return results.join('\n') + suffix;
      },
    }),

    find_files: tool({
      description:
        'Find files by name pattern. Recursively lists all files and filters by a simple glob pattern where * matches anything. Returns matching file paths.',
      parameters: z.object({
        pattern: z.string().describe('File name pattern (e.g. "*.md", "TODO*")'),
        path: z.string().default('.').describe('Directory path relative to agent root (defaults to root)'),
      }),
      execute: async ({ pattern, path }) => {
        const fullPath = path === '.' ? agentRoot : `${agentRoot}/${path}`;
        const matches: string[] = [];

        // Convert simple glob to regex: * -> .*, escape dots
        const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        const regex = new RegExp(regexStr);

        async function walk(dirPath: string, displayPrefix: string): Promise<void> {
          try {
            const entries = await opfs.listDir(dirPath);
            for (const entry of entries) {
              const childPath = `${dirPath}/${entry}`;
              const childDisplay = displayPrefix ? `${displayPrefix}/${entry}` : entry;
              // Check if it matches the pattern
              if (regex.test(entry)) {
                matches.push(childDisplay);
              }
              // Try to recurse into it as a directory
              try {
                await opfs.listDir(childPath);
                await walk(childPath, childDisplay);
              } catch {
                // Not a directory, skip
              }
            }
          } catch {
            // Not a directory or doesn't exist
          }
        }

        await walk(fullPath, '');
        if (matches.length === 0) {
          return `No files matching "${pattern}" found`;
        }
        return matches.join('\n');
      },
    }),

    delete_file: tool({
      description:
        'Delete a file from your private storage. Cannot delete CLAUDE.md (protected).',
      parameters: z.object({
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
      description:
        'Rename or move a file within your private storage. Reads the old file, writes to the new path, then deletes the old file.',
      parameters: z.object({
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
      description:
        'Get metadata about a file or directory: whether it exists, approximate size, and type (file or directory).',
      parameters: z.object({
        path: z.string().describe('File or directory path relative to agent root'),
      }),
      execute: async ({ path }) => {
        const fullPath = `${agentRoot}/${path}`;
        const fileExists = await opfs.exists(fullPath);
        if (!fileExists) {
          return JSON.stringify({ exists: false, path });
        }
        // Try as file
        try {
          const content = await opfs.readFile(fullPath);
          return JSON.stringify({
            exists: true,
            path,
            type: 'file',
            size: content.length,
          });
        } catch {
          // Try as directory
          try {
            const entries = await opfs.listDir(fullPath);
            return JSON.stringify({
              exists: true,
              path,
              type: 'directory',
              entries: entries.length,
            });
          } catch {
            return JSON.stringify({ exists: true, path, type: 'unknown' });
          }
        }
      },
    }),
  };
}

// ── Build system prompt ──

async function buildSystemPrompt(
  agentId: string,
  claudeMd: string,
  pageContext?: AgentLoopOptions['pageContext'],
): Promise<string> {
  const parts: string[] = [];

  // Core personality and instructions
  parts.push(claudeMd);

  // Recent activity journal
  try {
    const logPath = `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`;
    const lines = await opfs.readLines(logPath, JOURNAL_LINES);
    if (lines.length > 0) {
      parts.push('\n## Recent Activity\n');
      parts.push(
        'Here are your recent activity log entries (most recent last):\n',
      );
      parts.push('```jsonl');
      parts.push(lines.join('\n'));
      parts.push('```');
    }
  } catch {
    // No activity log yet — that's fine
  }

  // Pending messages from other agents (if agent is visible)
  try {
    const agents = await getAgentList();
    const self = agents.find((a) => a.id === agentId);
    if (self && self.visibility !== 'private') {
      const pendingMessages = await readPendingMessages(agentId);
      if (pendingMessages.length > 0) {
        parts.push('\n## Pending Messages from Other Agents\n');
        for (const msg of pendingMessages) {
          const sender = agents.find((a) => a.id === msg.from);
          const senderName = sender?.name ?? msg.from;
          parts.push(
            `- **${senderName}** (${msg.timestamp}): ${msg.body}`,
          );
        }
      }
    }
  } catch {
    // No messages or message bus not available
  }

  // Page context
  if (pageContext) {
    parts.push('\n## Current Page Context\n');
    parts.push(`**Title:** ${pageContext.title}`);
    parts.push(`**URL:** ${pageContext.url}`);
    parts.push('\n**Content:**\n');
    // Truncate very long page content to keep prompt manageable
    const maxContentLength = 8000;
    const content =
      pageContext.content.length > maxContentLength
        ? pageContext.content.slice(0, maxContentLength) + '\n\n[Content truncated]'
        : pageContext.content;
    parts.push(content);
  }

  return parts.join('\n');
}

// ── Read pending messages from shared message bus ──

interface SharedMessage {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  body: string;
}

async function readPendingMessages(
  agentId: string,
): Promise<SharedMessage[]> {
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
    // Return only the last 20 relevant messages
    return messages.slice(-20);
  } catch {
    return [];
  }
}

// ── Activity log ──

async function appendActivityLog(
  agentId: string,
  entry: ActivityLogEntry,
): Promise<void> {
  const logPath = `${AGENTS_ROOT}/${agentId}/${ACTIVITY_LOG}`;
  await opfs.appendFile(logPath, JSON.stringify(entry) + '\n');
}

// ── Mention resolution ──

interface ParsedMention {
  type: 'tab' | 'bookmark' | 'history' | 'agent';
  title: string;
  id: string;
  fullMatch: string;
}

function parseMentions(text: string): ParsedMention[] {
  const pattern = /@(tab|bookmark|history|agent)\[([^\]]*)\]\(([^)]*)\)/g;
  const mentions: ParsedMention[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    mentions.push({
      type: match[1] as ParsedMention['type'],
      title: match[2],
      id: match[3],
      fullMatch: match[0],
    });
  }
  return mentions;
}

async function resolveMentions(mentions: ParsedMention[]): Promise<string> {
  if (mentions.length === 0) return '';

  const parts: string[] = ['\n\n---\n**Context from mentioned sources:**\n'];

  for (const mention of mentions) {
    switch (mention.type) {
      case 'tab': {
        // Try to extract tab content via scripting
        const tabId = parseInt(mention.id, 10);
        if (isNaN(tabId)) {
          parts.push(`\n### Tab: ${mention.title}\n*Could not read tab: invalid tab ID*\n`);
          break;
        }
        try {
          const hasScripting = await chrome.permissions.contains({
            permissions: ['scripting'],
            origins: ['<all_urls>'],
          });
          if (!hasScripting) {
            // Fall back to basic tab info
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.id === tabId);
            parts.push(`\n### Tab: ${mention.title}\n**URL:** ${tab?.url || 'unknown'}\n*Scripting permission not granted - cannot extract page content*\n`);
            break;
          }
          // Try to get the tab's content
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              return {
                title: document.title,
                url: location.href,
                content: document.body?.innerText?.slice(0, 8000) || '',
              };
            },
          });
          const result = results?.[0]?.result as { title: string; url: string; content: string } | undefined;
          if (result) {
            parts.push(`\n### Tab: ${result.title}\n**URL:** ${result.url}\n\n${result.content}\n`);
          } else {
            parts.push(`\n### Tab: ${mention.title}\n*Could not extract content from this tab*\n`);
          }
        } catch (err) {
          parts.push(`\n### Tab: ${mention.title}\n*Error reading tab: ${err instanceof Error ? err.message : String(err)}*\n`);
        }
        break;
      }

      case 'bookmark':
      case 'history': {
        // For bookmarks and history, we have a URL - try to fetch content
        const url = mention.id;
        try {
          // Try to find an open tab with this URL first
          const tabs = await chrome.tabs.query({ url });
          if (tabs.length > 0 && tabs[0].id) {
            const hasScripting = await chrome.permissions.contains({
              permissions: ['scripting'],
              origins: ['<all_urls>'],
            });
            if (hasScripting) {
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: tabs[0].id },
                  func: () => ({
                    title: document.title,
                    url: location.href,
                    content: document.body?.innerText?.slice(0, 8000) || '',
                  }),
                });
                const result = results?.[0]?.result as { title: string; url: string; content: string } | undefined;
                if (result?.content) {
                  parts.push(`\n### ${mention.type === 'bookmark' ? 'Bookmark' : 'History'}: ${mention.title}\n**URL:** ${url}\n\n${result.content}\n`);
                  break;
                }
              } catch {
                // Fall through to URL-only
              }
            }
          }
          // Can't extract content - provide URL context
          parts.push(`\n### ${mention.type === 'bookmark' ? 'Bookmark' : 'History'}: ${mention.title}\n**URL:** ${url}\n`);
        } catch {
          parts.push(`\n### ${mention.type === 'bookmark' ? 'Bookmark' : 'History'}: ${mention.title}\n**URL:** ${url}\n`);
        }
        break;
      }

      case 'agent': {
        // Include agent's name and role as context
        const agentList = await getAgentList();
        const referencedAgent = agentList.find(a => a.id === mention.id);
        if (referencedAgent) {
          parts.push(`\n### Agent: ${referencedAgent.name}\n**Role:** ${referencedAgent.role}\n**Visibility:** ${referencedAgent.visibility}\n`);
        } else {
          parts.push(`\n### Agent: ${mention.title}\n*Agent not found*\n`);
        }
        break;
      }
    }
  }

  return parts.join('');
}

// ── Main loop ──

/**
 * Run the agent loop: builds context, calls the AI provider, processes
 * tool calls, streams the response, and logs the activity.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<string> {
  const { agentId, pageContext, onChunk, onToolCall, toolLookupStrategy = 'static' } = options;
  let { userMessage } = options;

  // 0. Resolve any @mentions in the user message
  const mentions = parseMentions(userMessage);
  if (mentions.length > 0) {
    const mentionContext = await resolveMentions(mentions);
    userMessage = userMessage + mentionContext;
  }

  // 1. Read agent's CLAUDE.md from OPFS
  const claudeMdPath = `${AGENTS_ROOT}/${agentId}/CLAUDE.md`;
  let claudeMd: string;
  try {
    claudeMd = await opfs.readFile(claudeMdPath);
  } catch {
    throw new Error(`Agent not found or missing CLAUDE.md: ${agentId}`);
  }

  // 2. Build system prompt
  const systemPrompt = await buildSystemPrompt(agentId, claudeMd, pageContext);

  // 3. Get provider configuration and API key
  const settings = await getSettings();
  const apiKeys = await getApiKeys();
  const apiKey = apiKeys[settings.activeProvider];
  if (!apiKey) {
    throw new Error(
      `No API key configured for provider: ${settings.activeProvider}`,
    );
  }

  const model = createLanguageModel(settings.activeProvider, apiKey);

  // 4. Define tools (file tools + communication tools if visible/open)
  const agents = await getAgentList();
  const selfMeta = agents.find((a) => a.id === agentId);
  const isVisible = selfMeta && selfMeta.visibility !== 'private';

  // Build the full tool set (always available for resolution)
  const wasmTools = await getWasmTools();
  const unfilteredTools: ToolSet = {
    ...createAgentTools(agentId),
    ...(await getChromeTools(agentId)),
    ...(isVisible ? getCommunicationTools(agentId) : {}),
    ...wasmTools,
    ...getWebTools({ braveApiKey: apiKeys.brave }),
  };

  // Filter tools based on agent's enabledTools/disabledTools config
  const allTools = filterToolsByConfig(unfilteredTools, selfMeta);

  // Determine which tools to pass based on lookup strategy
  let tools: ToolSet;
  if (toolLookupStrategy === 'static') {
    // Include all tools as before — no lookup needed
    tools = allTools;
  } else {
    // Start with only the lookup_tools meta-tool; resolved tools are
    // injected dynamically when the agent calls lookup_tools
    // Pass the OpenAI key for embedding lookup (text-embedding-3-small)
    const embeddingApiKey = apiKeys.openai || apiKey;
    const lookup = createToolLookup(toolLookupStrategy, { apiKey: embeddingApiKey });

    tools = {
      lookup_tools: tool({
        description:
          'Describe what you need to do and this tool will return the most relevant tools. ' +
          'Call this before attempting to use any other tool.',
        parameters: z.object({
          intent: z.string().describe('Natural language description of what you want to do'),
          count: z.number().optional().default(5).describe('Number of tools to return'),
        }),
        execute: async ({ intent, count }) => {
          const resolved = await lookup.resolve(intent, count);
          // Inject the resolved tools into the active tool set so the
          // agent can use them in subsequent steps
          for (const meta of resolved) {
            if (meta.name in allTools) {
              tools[meta.name] = allTools[meta.name];
            }
          }
          return resolved.map((m) => ({
            name: m.name,
            description: m.description,
            category: m.category,
          }));
        },
      }),
    };
  }

  // 4b. Wrap tools with permission checks
  tools = wrapToolsWithPermissions(tools);

  // 4c. Wrap tools with reporting if callback provided
  if (onToolCall) {
    tools = wrapToolsWithReporting(tools, onToolCall);
  }

  // 5. Log user message
  await appendActivityLog(agentId, {
    timestamp: new Date().toISOString(),
    role: 'user',
    summary: userMessage.slice(0, 200),
  });

  // 6. Call the AI provider
  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    maxSteps: 10,
  });

  // 7. Stream response and collect full text
  let fullResponse = '';
  const toolCallNames: string[] = [];

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        fullResponse += part.textDelta;
        onChunk?.(part.textDelta);
        break;
      case 'tool-call':
        toolCallNames.push(part.toolName);
        break;
    }
  }

  // 8. Log assistant response
  await appendActivityLog(agentId, {
    timestamp: new Date().toISOString(),
    role: 'assistant',
    summary: fullResponse.slice(0, 200),
    toolCalls: toolCallNames.length > 0 ? toolCallNames : undefined,
  });

  return fullResponse;
}
