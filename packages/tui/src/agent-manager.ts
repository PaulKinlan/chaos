/**
 * Agent Manager — handles agent lifecycle, persistence, and conversations.
 *
 * Stores agent data in .chaos/ directory:
 *   .chaos/agents.json        — agent metadata registry
 *   .chaos/{agentId}/CLAUDE.md — agent personality/instructions
 *   .chaos/{agentId}/memories/ — persistent memory
 *   .chaos/{agentId}/conversations/ — chat history
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAgent, createFileTools } from '@chaos/agent-loop';
import type { Agent, AgentConfig } from '@chaos/agent-loop';
import { getTemplate, listRoles } from './templates/index.js';
import { createProjectTools } from './tools.js';
import { createFsMemoryStore } from './stores/fs-memory.js';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const AGENTS_FILE = path.join(BASE_DIR, 'agents.json');

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface ConversationToolCall {
  name: string;
  args: string;
  result?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ConversationToolCall[];
}

export interface ConversationEntry {
  id: string;
  agentId: string;
  timestamp: string;
  messages: ConversationMessage[];
}

// ── Registry ──

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadAgentRegistry(): AgentMeta[] {
  ensureDir(BASE_DIR);
  if (!fs.existsSync(AGENTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAgentRegistry(agents: AgentMeta[]): void {
  ensureDir(BASE_DIR);
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
}

// ── Agent CRUD ──

export function createAgentMeta(name: string, role: string): AgentMeta {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const meta: AgentMeta = {
    id,
    name,
    role,
    createdAt: new Date().toISOString(),
  };

  // Create directory structure
  const agentDir = path.join(BASE_DIR, id);
  ensureDir(path.join(agentDir, 'memories'));
  ensureDir(path.join(agentDir, 'people'));
  ensureDir(path.join(agentDir, 'ideas'));
  ensureDir(path.join(agentDir, 'conversations'));

  // Write CLAUDE.md from template
  const template = getTemplate(role);
  const claudeMd = template(name);
  fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), claudeMd, 'utf-8');

  // Write seed files
  fs.writeFileSync(path.join(agentDir, 'TODO.md'), '# TODO\n\n(no tasks yet)\n', 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'memories', 'user.md'), '# User\n\n(no info yet)\n', 'utf-8');

  // Update registry
  const registry = loadAgentRegistry();
  registry.push(meta);
  saveAgentRegistry(registry);

  return meta;
}

export function deleteAgentMeta(agentId: string): void {
  const registry = loadAgentRegistry().filter(a => a.id !== agentId);
  saveAgentRegistry(registry);
  // Don't delete files — preserve history
}

// ── CLAUDE.md ──

export function readClaudeMd(agentId: string): string {
  const filePath = path.join(BASE_DIR, agentId, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeClaudeMd(agentId: string, content: string): void {
  const filePath = path.join(BASE_DIR, agentId, 'CLAUDE.md');
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ── Conversations ──

export function saveConversation(agentId: string, convo: ConversationEntry): void {
  const dir = path.join(BASE_DIR, agentId, 'conversations');
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${convo.id}.json`), JSON.stringify(convo, null, 2), 'utf-8');
}

export function listConversations(agentId: string): Array<{ id: string; timestamp: string; preview: string }> {
  const dir = path.join(BASE_DIR, agentId, 'conversations');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  return files.slice(0, 20).map(f => {
    try {
      const convo: ConversationEntry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      const firstMsg = convo.messages[0]?.content || '(empty)';
      return {
        id: convo.id,
        timestamp: convo.timestamp,
        preview: firstMsg.slice(0, 60),
      };
    } catch {
      return { id: f.replace('.json', ''), timestamp: '', preview: '(unreadable)' };
    }
  });
}

// ── Create Agent Instance ──

export function createAgentInstance(meta: AgentMeta, model: AgentConfig['model']): Agent {
  const claudeMd = readClaudeMd(meta.id);

  // Memory tools — scoped to .chaos/{agentId}/ via MemoryStore
  const memoryStore = createFsMemoryStore(BASE_DIR);
  const memoryTools = createFileTools(memoryStore, meta.id);

  // Project tools — read/write/search the working directory
  const projectTools = createProjectTools();

  const runtimeContext = `

## Runtime Context

You have TWO separate sets of file tools:

### Memory Tools (your private storage)
These operate on your private directory. Use them for your memories, TODO, people, ideas:
- **read_file** — Read from your private storage (e.g. \`memories/user.md\`, \`TODO.md\`)
- **write_file** — Write to your private storage
- **edit_file** — Edit a file in your private storage
- **list_directory** — List your private files
- **delete_file** — Delete a file from your private storage
- **grep_file** — Search your private files
- **find_files** — Find files by pattern in your private storage

### Project Tools (the working directory: ${process.cwd()})
These operate on the project filesystem. Use them to explore and modify the codebase:
- **project_read** — Read a project file
- **project_list** — List project directory contents
- **project_write** — Write a project file (ONLY when asked)
- **project_edit** — Edit a project file (ONLY when asked)
- **project_search** — Grep project files
- **project_info** — Get project file metadata
- **shell** — Run a shell command

### IMPORTANT: When to use which
- "My name is Paul" → Use **write_file** to save to \`memories/user.md\`
- "What files are in this project?" → Use **project_list**
- "Summarize this codebase" → Use **project_read** and **project_list**
- "Remember that I prefer TypeScript" → Use **write_file** or **edit_file** on your CLAUDE.md
- "Create a new file called app.ts" → Use **project_write** (only because the user asked)
`;

  const systemPrompt = claudeMd
    ? claudeMd + runtimeContext
    : `You are ${meta.name}, a helpful assistant.${runtimeContext}`;

  return createAgent({
    id: meta.id,
    name: meta.name,
    model,
    systemPrompt,
    tools: { ...memoryTools, ...projectTools },
    maxIterations: 20,
    permissions: { mode: 'accept-all' },
  });
}

export { listRoles };
