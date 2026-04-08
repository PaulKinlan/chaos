#!/usr/bin/env node

/**
 * CHAOS CLI — reference implementation for @chaos/sdk + @chaos/agent-loop
 *
 * All data persists to ~/.chaos-data/:
 *   memory/    — per-agent files (CLAUDE.md, memories/, etc.)
 *   agents.json — agent registry
 *   settings.json — global settings
 *   hooks.json — hooks
 *   usage.json — usage records
 *   conversations/ — conversation history
 */

import { createAgent, createFileTools } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ChaosSDK } from '@chaos/sdk';
import type { AgentMeta, Conversation, ConversationMessage } from '@chaos/sdk';
import { NodeFileStore } from './stores/node-file-store.js';
import { JsonSettingsStore } from './stores/json-settings-store.js';
import type { LanguageModel } from 'ai';

// ── Data directory ──

const DATA_DIR = path.join(os.homedir(), '.chaos-data');

// ── JSON file-backed stores (persistent) ──

class JsonAgentStore {
  private filePath: string;
  constructor(dir: string) { this.filePath = path.join(dir, 'agents.json'); }
  private async load(): Promise<AgentMeta[]> {
    try { return JSON.parse(await fs.readFile(this.filePath, 'utf-8')); } catch { return []; }
  }
  private async save(agents: AgentMeta[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(agents, null, 2));
  }
  async list(): Promise<AgentMeta[]> { return this.load(); }
  async get(id: string): Promise<AgentMeta | undefined> { return (await this.load()).find(a => a.id === id); }
  async add(agent: AgentMeta): Promise<void> { const a = await this.load(); a.push(agent); await this.save(a); }
  async update(id: string, updates: Partial<AgentMeta>): Promise<void> {
    const a = await this.load(); const i = a.findIndex(x => x.id === id);
    if (i >= 0) { a[i] = { ...a[i], ...updates }; await this.save(a); }
  }
  async remove(id: string): Promise<void> { await this.save((await this.load()).filter(a => a.id !== id)); }
}

class JsonHookStore {
  private filePath: string;
  constructor(dir: string) { this.filePath = path.join(dir, 'hooks.json'); }
  private async load(): Promise<any[]> { try { return JSON.parse(await fs.readFile(this.filePath, 'utf-8')); } catch { return []; } }
  private async save(hooks: any[]): Promise<void> { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); await fs.writeFile(this.filePath, JSON.stringify(hooks, null, 2)); }
  async list(agentId?: string): Promise<any[]> { const h = await this.load(); return agentId ? h.filter((x: any) => x.agentId === agentId) : h; }
  async get(id: string): Promise<any> { return (await this.load()).find((h: any) => h.id === id); }
  async add(hook: any): Promise<void> { const h = await this.load(); h.push(hook); await this.save(h); }
  async update(id: string, updates: any): Promise<void> { const h = await this.load(); const i = h.findIndex((x: any) => x.id === id); if (i >= 0) { h[i] = { ...h[i], ...updates }; await this.save(h); } }
  async remove(id: string): Promise<void> { await this.save((await this.load()).filter((h: any) => h.id !== id)); }
}

class JsonUsageStore {
  private filePath: string;
  constructor(dir: string) { this.filePath = path.join(dir, 'usage.json'); }
  private async load(): Promise<any[]> { try { return JSON.parse(await fs.readFile(this.filePath, 'utf-8')); } catch { return []; } }
  private async save(records: any[]): Promise<void> { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); await fs.writeFile(this.filePath, JSON.stringify(records, null, 2)); }
  async record(entry: any): Promise<void> { const r = await this.load(); r.push(entry); await this.save(r.slice(-5000)); }
  async query(options?: any): Promise<any[]> { let r = await this.load(); if (options?.agentId) r = r.filter((x: any) => x.agentId === options.agentId); if (options?.since) { const t = new Date(options.since).getTime(); r = r.filter((x: any) => new Date(x.timestamp).getTime() >= t); } return r.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, options?.limit || 50); }
  async clear(): Promise<void> { await this.save([]); }
}

class FileConversationStore {
  private dir: string;
  constructor(dir: string) { this.dir = path.join(dir, 'conversations'); }
  private filePath(agentId: string, convId: string): string { return path.join(this.dir, agentId, `${convId}.json`); }
  async get(agentId: string, convId: string): Promise<Conversation | undefined> {
    try { return JSON.parse(await fs.readFile(this.filePath(agentId, convId), 'utf-8')); } catch { return undefined; }
  }
  async list(agentId: string): Promise<Array<{ id: string; timestamp: string }>> {
    try {
      const dir = path.join(this.dir, agentId);
      const files = await fs.readdir(dir);
      return files.filter(f => f.endsWith('.json')).map(f => ({ id: f.replace('.json', ''), timestamp: '' }));
    } catch { return []; }
  }
  async save(agentId: string, conversation: Conversation): Promise<void> {
    const fp = this.filePath(agentId, conversation.id);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(conversation, null, 2));
  }
  async delete(agentId: string, convId: string): Promise<void> {
    try { await fs.unlink(this.filePath(agentId, convId)); } catch { /* */ }
  }
}

// ── Model resolution ──

function parseFlag(flag: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  if (arg) return arg.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${flag}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function resolveModel(
  mockResponses?: Array<{ text?: string }>,
  agentConfig?: { provider?: string; model?: string },
): Promise<LanguageModel> {
  // CLI flags override agent config, agent config overrides mock
  const provider = parseFlag('provider') || agentConfig?.provider;
  if (!provider) {
    return createMockModel({ responses: mockResponses || [{ text: 'Mock response.' }] }) as any;
  }

  const modelId = parseFlag('model') || agentConfig?.model;

  switch (provider) {
    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1); }
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const m = modelId || 'claude-sonnet-4-6';
      console.log(`Using Anthropic: ${m}`);
      return createAnthropic({ apiKey: key })(m) as unknown as LanguageModel;
    }
    case 'google': {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) { console.error('Set GOOGLE_API_KEY'); process.exit(1); }
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const m = modelId || 'gemini-2.5-flash';
      console.log(`Using Google: ${m}`);
      return createGoogleGenerativeAI({ apiKey: key })(m) as unknown as LanguageModel;
    }
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) { console.error('Set OPENAI_API_KEY'); process.exit(1); }
      const { createOpenAI } = await import('@ai-sdk/openai');
      const m = modelId || 'gpt-4.1-mini';
      console.log(`Using OpenAI: ${m}`);
      return createOpenAI({ apiKey: key })(m) as unknown as LanguageModel;
    }
    default:
      console.error(`Unknown provider: ${provider}. Use: anthropic, google, openai`);
      process.exit(1);
  }
}

// ── Build SDK ──

function createSDK() {
  const memory = new NodeFileStore(path.join(DATA_DIR, 'memory'));
  const agentStore = new JsonAgentStore(DATA_DIR);
  const settings = new JsonSettingsStore(path.join(DATA_DIR, 'settings.json'));
  const hooks = new JsonHookStore(DATA_DIR);
  const usage = new JsonUsageStore(DATA_DIR);
  const conversations = new FileConversationStore(DATA_DIR);

  const sdk = new ChaosSDK({
    settings,
    memory,
    conversations,
    hooks,
    usage,
    agentStore,
  });

  return { sdk, agentStore, memory };
}

/** Create an agent loop with file tools and the resolved model */
async function createAgentLoop(id: string, name: string, model: LanguageModel, memory: NodeFileStore) {
  // Read CLAUDE.md if it exists
  let systemPrompt: string | undefined;
  try { systemPrompt = await memory.read(id, 'CLAUDE.md'); } catch { /* */ }

  return createAgent({
    id,
    name,
    model,
    systemPrompt,
    tools: createFileTools(memory, id),
    maxIterations: 20,
  });
}

// ── Commands ──

async function agentsList(sdk: ChaosSDK): Promise<void> {
  const agents = await sdk.agents.list();
  if (agents.length === 0) { console.log('No agents found. Create one: chaos agents create "My Agent"'); return; }
  console.log('Agents:');
  for (const a of agents) {
    const provLabel = a.provider ? `${a.provider}${a.model ? `/${a.model}` : ''}` : 'mock';
    console.log(`  ${a.name.padEnd(20)} ${a.id}  ${provLabel}`);
  }
}

async function agentsCreate(sdk: ChaosSDK, agentStore: JsonAgentStore, memory: NodeFileStore, name: string): Promise<void> {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const provider = parseFlag('provider');
  const model = parseFlag('model');

  const agent: AgentMeta = {
    id,
    name,
    role: 'neutral',
    visibility: 'visible',
    createdAt: new Date().toISOString(),
    provider: provider || undefined,
    model: model || undefined,
  };
  await agentStore.add(agent);

  // Seed memory files
  await memory.write(id, 'CLAUDE.md', `# ${name}\n\nYou are ${name}, an AI assistant.\n`);
  await memory.mkdir(id, 'memories');
  await memory.write(id, 'memories/user.md', '# User\n\nFacts about the user.\n');

  console.log(`Created agent: ${name} (${id})`);
  if (provider) console.log(`  Provider: ${provider}${model ? ` (${model})` : ''}`);
  else console.log(`  Provider: mock (use --provider to set a real LLM)`);
  console.log(`  Memory: ~/.chaos-data/memory/${id}/`);
  console.log(`  CLAUDE.md seeded — edit it to customize the agent's personality.`);
}

async function agentsDelete(sdk: ChaosSDK, agentStore: JsonAgentStore, id: string): Promise<void> {
  const agent = await agentStore.get(id);
  if (!agent) { console.error(`Agent not found: ${id}`); process.exit(1); }
  await agentStore.remove(id);
  console.log(`Deleted agent: ${agent.name} (${id})`);
}

async function chat(sdk: ChaosSDK, memory: NodeFileStore, agentId: string, message: string): Promise<void> {
  const agentStore = new JsonAgentStore(DATA_DIR);
  const agent = await agentStore.get(agentId);
  if (!agent) { console.error(`Agent not found: ${agentId}\nRun 'chaos agents list' to see available agents.`); process.exit(1); }

  const model = await resolveModel(
    [{ text: `I'm ${agent.name}. I can help with research, writing, and analysis.` }],
    { provider: agent.provider, model: agent.model },
  );
  const agentLoop = await createAgentLoop(agentId, agent.name, model, memory);
  sdk.chat.registerAgent(agentLoop);

  console.log(`\nChatting with ${agent.name}...\n`);

  // Collect conversation
  const messages: ConversationMessage[] = [];
  messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

  let responseText = '';
  for await (const update of sdk.chat.sendMessage(agentId, message)) {
    switch (update.type) {
      case 'thinking':
        process.stdout.write(`  [thinking] ${update.content}\n`);
        break;
      case 'tool-call':
        process.stdout.write(`  [tool] ${update.toolName}(${JSON.stringify(update.toolArgs).slice(0, 100)})\n`);
        break;
      case 'tool-result':
        process.stdout.write(`  [result] ${String(update.toolResult).slice(0, 200)}\n`);
        break;
      case 'step-complete':
        process.stdout.write(`  --- step ${update.iteration} complete ---\n`);
        break;
      case 'done':
        responseText = update.content;
        break;
      case 'error':
        console.error(`\n  [error] ${update.content}`);
        break;
    }
  }

  if (responseText) {
    console.log(`\n${agent.name}: ${responseText}`);
    messages.push({ role: 'assistant', content: responseText, timestamp: new Date().toISOString() });
  }

  // Save conversation
  const convId = `conv-${Date.now()}`;
  await sdk.chat.saveConversation(agentId, convId, { id: convId, agentId, timestamp: new Date().toISOString(), messages });
  console.log(`\nConversation saved: ${convId}`);
}

async function conversationsList(sdk: ChaosSDK, agentId: string): Promise<void> {
  const convs = await sdk.chat.listConversations(agentId);
  if (convs.length === 0) { console.log('No conversations found.'); return; }
  console.log(`Conversations for ${agentId}:`);
  for (const c of convs) {
    const conv = await sdk.chat.getConversation(agentId, c.id);
    const msgCount = conv?.messages?.length || 0;
    console.log(`  ${c.id}  ${msgCount} messages`);
  }
}

async function conversationShow(sdk: ChaosSDK, agentId: string, convId: string): Promise<void> {
  const conv = await sdk.chat.getConversation(agentId, convId);
  if (!conv) { console.error('Conversation not found.'); process.exit(1); }
  for (const m of conv.messages) {
    const role = m.role === 'user' ? 'You' : 'Agent';
    console.log(`[${role}] ${m.content.slice(0, 500)}`);
  }
}

async function memoryList(sdk: ChaosSDK, agentId: string, dir?: string): Promise<void> {
  const entries = await sdk.files.list(agentId, dir);
  if (entries.length === 0) { console.log('(empty)'); return; }
  for (const e of entries) {
    console.log(`  ${e.type === 'directory' ? '📁' : '📄'} ${e.name}`);
  }
}

async function memoryRead(sdk: ChaosSDK, agentId: string, filePath: string): Promise<void> {
  try {
    const content = await sdk.files.read(agentId, filePath);
    console.log(content);
  } catch {
    console.error(`File not found: ${filePath}`);
  }
}

async function hooksList(sdk: ChaosSDK): Promise<void> {
  const hooks = await sdk.hooks.list();
  if (hooks.length === 0) { console.log('No hooks found.'); return; }
  for (const h of hooks) {
    console.log(`  ${h.id}  agent:${h.agentId}  trigger:${h.trigger.type}  ${h.enabled ? 'enabled' : 'disabled'}`);
    console.log(`    ${h.description}`);
  }
}

async function usageSummary(sdk: ChaosSDK): Promise<void> {
  const summary = await sdk.usage.getSummary();
  console.log(`Usage: ${summary.totalRequests} requests, $${summary.totalCost.toFixed(4)}`);
  console.log(`  Input: ${summary.totalInputTokens} tokens  Output: ${summary.totalOutputTokens} tokens`);
  for (const [p, s] of Object.entries(summary.byProvider)) {
    console.log(`  ${p}: ${s.requests} requests, $${s.cost.toFixed(4)}`);
  }
}

function showHelp(): void {
  console.log(`chaos — CLI for @chaos/sdk + @chaos/agent-loop

Usage:
  chaos agents list                    List all agents
  chaos agents create <name>           Create a new agent (use --provider/--model to set LLM)
  chaos agents delete <id>             Delete an agent

  chaos chat <agent-id> <message>      Chat with an agent
  chaos conversations <agent-id>       List conversations
  chaos conversation <agent-id> <id>   Show a conversation

  chaos memory <agent-id> [path]       List agent memory files
  chaos memory:read <agent-id> <path>  Read a memory file

  chaos hooks list                     List all hooks
  chaos usage summary                  Show usage summary
  chaos help                           Show this help

Flags:
  --provider anthropic|google|openai   Use a real LLM (default: mock)
  --model=<model-id>                   Override the default model

Environment:
  ANTHROPIC_API_KEY    API key for Anthropic
  GOOGLE_API_KEY       API key for Google
  OPENAI_API_KEY       API key for OpenAI

Data: ~/.chaos-data/`);
}

// ── Main ──

async function main(): Promise<void> {
  // Strip flags and their values from positional args
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      // Skip --flag=value (single arg) or --flag value (two args)
      if (!rawArgs[i].includes('=')) i++; // skip the next arg too
      continue;
    }
    args.push(rawArgs[i]);
  }

  if (args.length === 0 || args[0] === 'help') { showHelp(); return; }

  const { sdk, agentStore, memory } = createSDK();
  const [group, command, ...rest] = args;

  switch (group) {
    case 'agents':
      switch (command) {
        case 'list': await agentsList(sdk); break;
        case 'create': {
          const name = rest.join(' ');
          if (!name) { console.error('Usage: chaos agents create <name>'); process.exit(1); }
          await agentsCreate(sdk, agentStore, memory, name);
          break;
        }
        case 'delete': {
          if (!rest[0]) { console.error('Usage: chaos agents delete <id>'); process.exit(1); }
          await agentsDelete(sdk, agentStore, rest[0]);
          break;
        }
        default: console.error(`Unknown: agents ${command}`); showHelp(); process.exit(1);
      }
      break;

    case 'chat': {
      const agentId = command;
      const message = rest.join(' ');
      if (!agentId || !message) { console.error('Usage: chaos chat <agent-id> <message>'); process.exit(1); }
      await chat(sdk, memory, agentId, message);
      break;
    }

    case 'conversations':
      if (!command) { console.error('Usage: chaos conversations <agent-id>'); process.exit(1); }
      await conversationsList(sdk, command);
      break;

    case 'conversation':
      if (!command || !rest[0]) { console.error('Usage: chaos conversation <agent-id> <conv-id>'); process.exit(1); }
      await conversationShow(sdk, command, rest[0]);
      break;

    case 'memory':
      if (!command) { console.error('Usage: chaos memory <agent-id> [path]'); process.exit(1); }
      await memoryList(sdk, command, rest[0]);
      break;

    case 'memory:read':
      if (!command || !rest[0]) { console.error('Usage: chaos memory:read <agent-id> <path>'); process.exit(1); }
      await memoryRead(sdk, command, rest[0]);
      break;

    case 'hooks':
      if (command === 'list') { await hooksList(sdk); }
      else { console.error(`Unknown: hooks ${command}`); process.exit(1); }
      break;

    case 'usage':
      if (command === 'summary') { await usageSummary(sdk); }
      else { console.error(`Unknown: usage ${command}`); process.exit(1); }
      break;

    default:
      console.error(`Unknown command: ${group}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
