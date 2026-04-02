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

// ── Main loop ──

/**
 * Run the agent loop: builds context, calls the AI provider, processes
 * tool calls, streams the response, and logs the activity.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<string> {
  const { agentId, userMessage, pageContext, onChunk, toolLookupStrategy = 'static' } = options;

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
  const allTools: ToolSet = {
    ...createAgentTools(agentId),
    ...(await getChromeTools(agentId)),
    ...(isVisible ? getCommunicationTools(agentId) : {}),
    ...wasmTools,
    ...getWebTools(),
  };

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
