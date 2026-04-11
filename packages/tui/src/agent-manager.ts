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
import { createAgent } from '@chaos/agent-loop';
import type { Agent, AgentConfig } from '@chaos/agent-loop';
import { getTemplate, listRoles } from './templates/index.js';
import { createOsTools } from './tools.js';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const AGENTS_FILE = path.join(BASE_DIR, 'agents.json');

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface ConversationEntry {
  id: string;
  agentId: string;
  timestamp: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
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
  const osTools = createOsTools();
  const agentDir = path.resolve(BASE_DIR, meta.id);

  // Append context about the agent's private storage location
  const storageContext = `

## Runtime Context

- **Working directory:** ${process.cwd()}
- **Your private storage:** ${agentDir}/
  - To read/write your own memory files, use paths like \`.chaos/${meta.id}/memories/user.md\`
  - To read/write project files, use paths relative to the working directory
- **Your CLAUDE.md:** \`.chaos/${meta.id}/CLAUDE.md\`
`;

  const systemPrompt = claudeMd
    ? claudeMd + storageContext
    : `You are ${meta.name}, a helpful assistant.${storageContext}`;

  return createAgent({
    id: meta.id,
    name: meta.name,
    model,
    systemPrompt,
    tools: { ...osTools },
    maxIterations: 20,
    permissions: { mode: 'accept-all' },
  });
}

export { listRoles };
