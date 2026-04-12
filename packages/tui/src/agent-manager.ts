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
import { createProjectTools, createWebTools, createSystemTools, createScheduleTools, createHookTools, createChannelTools } from './tools.js';
import { createFsMemoryStore } from './stores/fs-memory.js';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const AGENTS_FILE = path.join(BASE_DIR, 'agents.json');
const SESSION_FILE = path.join(BASE_DIR, 'session.json');

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  provider?: string;            // per-agent model provider override
  model?: string;               // per-agent model ID override
  enabledToolSets?: string[];   // which tool sets to enable: 'memory', 'project', 'web', 'system'
  disabledTools?: string[];     // specific tools to disable
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

export function updateAgentMeta(agentId: string, updates: Partial<AgentMeta>): void {
  const registry = loadAgentRegistry();
  const idx = registry.findIndex(a => a.id === agentId);
  if (idx === -1) return;
  registry[idx] = { ...registry[idx]!, ...updates };
  saveAgentRegistry(registry);
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

export function createAgentInstance(meta: AgentMeta, model: AgentConfig['model'], providerTools?: Record<string, unknown>): Agent {
  const claudeMd = readClaudeMd(meta.id);

  // Build tool sets based on agent config
  const enabledSets = new Set(meta.enabledToolSets || ['memory', 'project', 'web', 'system']);
  const disabledTools = new Set(meta.disabledTools || []);

  let allTools: Record<string, unknown> = {};

  if (enabledSets.has('memory')) {
    const memoryStore = createFsMemoryStore(BASE_DIR);
    Object.assign(allTools, createFileTools(memoryStore, meta.id));
  }
  if (enabledSets.has('project')) {
    Object.assign(allTools, createProjectTools());
  }
  if (enabledSets.has('web')) {
    Object.assign(allTools, createWebTools());
  }
  if (enabledSets.has('system')) {
    Object.assign(allTools, createSystemTools());
  }

  // Schedule and hook tools always available
  Object.assign(allTools, createScheduleTools(meta.id));
  Object.assign(allTools, createHookTools(meta.id));
  Object.assign(allTools, createChannelTools(meta.id));

  // Provider-native tools (web search, bash, text editor, code execution, etc.)
  // Provider tools take priority — they're server-side and more capable.
  // Our custom tools (fetch_url, web_search from createWebTools) serve as fallbacks
  // under different names so both are available.
  if (providerTools) {
    Object.assign(allTools, providerTools);
  }

  // Remove individually disabled tools
  for (const name of disabledTools) {
    delete allTools[name];
  }

  const runtimeContext = `

## Runtime

Working directory: ${process.cwd()}
`;

  const systemPrompt = claudeMd
    ? claudeMd + runtimeContext
    : `You are ${meta.name}, a helpful assistant.${runtimeContext}`;

  return createAgent({
    id: meta.id,
    name: meta.name,
    model,
    systemPrompt,
    tools: allTools as AgentConfig['tools'],
    maxIterations: 15,
    permissions: { mode: 'accept-all' },
  });
}

// ── Session State ──

export interface SessionColumn {
  agentId: string;
  conversationId: string;
}

export interface SessionState {
  columns: SessionColumn[];
  activeIndex: number;
  savedAt: string;
}

export function saveSession(state: SessionState): void {
  ensureDir(BASE_DIR);
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function loadSession(): SessionState | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadConversation(agentId: string, conversationId: string): ConversationEntry | null {
  const filePath = path.join(BASE_DIR, agentId, 'conversations', `${conversationId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export { listRoles };
