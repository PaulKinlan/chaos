#!/usr/bin/env node

import { createAgent } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import * as path from 'node:path';
import * as os from 'node:os';
import { ChaosSDK } from '@chaos/sdk';
import { NodeFileStore } from './stores/node-file-store.js';
import { JsonSettingsStore } from './stores/json-settings-store.js';
import {
  InMemoryConversationStore,
  InMemoryHookStore,
  InMemoryUsageStore,
  InMemoryAgentStore,
} from './stores/in-memory.js';
import type { AgentMeta } from '@chaos/sdk';

// ── Data directory ──

const DATA_DIR = path.join(os.homedir(), '.chaos-data');

// ── Build SDK ──

function createSDK(): { sdk: ChaosSDK; agentStore: InMemoryAgentStore } {
  const agentStore = new InMemoryAgentStore();
  const memory = new NodeFileStore(path.join(DATA_DIR, 'memory'));
  const settings = new JsonSettingsStore(path.join(DATA_DIR, 'settings.json'));
  const conversations = new InMemoryConversationStore();
  const hooks = new InMemoryHookStore();
  const usage = new InMemoryUsageStore();

  const sdk = new ChaosSDK({
    settings,
    memory,
    conversations,
    hooks,
    usage,
    agentStore: agentStore,
    // No agentLoops here — agents are registered when created
  });

  return { sdk, agentStore };
}

/** Create a mock agent loop for a given agent ID/name */
function createMockAgentLoop(id: string, name: string) {
  return createAgent({
    id,
    name,
    model: createMockModel({
      responses: [
        { text: `I'm ${name}. I can help you with research, writing, and analysis. (MockModel response)` },
      ],
    }) as any,
    maxIterations: 10,
  });
}

// ── Commands ──

async function agentsList(sdk: ChaosSDK): Promise<void> {
  const agents = await sdk.agents.list();
  if (agents.length === 0) {
    console.log('No agents found.');
    return;
  }
  console.log('Agents:');
  for (const a of agents) {
    console.log(`  ${a.name}  ${a.id}  role:${a.role}  ${a.visibility}`);
  }
}

async function agentsCreate(sdk: ChaosSDK, agentStore: InMemoryAgentStore, name: string): Promise<void> {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const agent: AgentMeta = {
    id,
    name,
    role: 'neutral',
    visibility: 'visible',
    createdAt: new Date().toISOString(),
  };
  await agentStore.add(agent);

  // Register an agent loop so chat works for this agent
  sdk.chat.registerAgent(createMockAgentLoop(id, name));

  console.log(`Created agent: ${agent.name} (${agent.id})`);
}

async function agentsDelete(sdk: ChaosSDK, agentStore: InMemoryAgentStore, id: string): Promise<void> {
  await agentStore.remove(id);
  console.log(`Deleted agent: ${id}`);
}

async function chat(sdk: ChaosSDK, agentId: string, message: string): Promise<void> {
  let step = 0;
  for await (const update of sdk.chat.sendMessage(agentId, message)) {
    switch (update.type) {
      case 'thinking':
        step++;
        console.log(`[Step ${step}] ${update.content}`);
        break;
      case 'text':
        console.log(`[Step ${step || 1}] ${update.content}`);
        break;
      case 'tool-call':
        console.log(`[Tool] ${update.toolName}(${JSON.stringify(update.toolArgs)})`);
        break;
      case 'tool-result':
        console.log(`[Tool Result] ${JSON.stringify(update.toolResult)}`);
        break;
      case 'step-complete':
        break;
      case 'done':
        console.log(`[Done] ${update.content}`);
        break;
      case 'error':
        console.error(`[Error] ${update.content}`);
        break;
    }
  }
}

async function hooksList(sdk: ChaosSDK): Promise<void> {
  const hooks = await sdk.hooks.list();
  if (hooks.length === 0) {
    console.log('No hooks found.');
    return;
  }
  console.log('Hooks:');
  for (const h of hooks) {
    console.log(`  ${h.id}  agent:${h.agentId}  trigger:${h.trigger.type}  ${h.enabled ? 'enabled' : 'disabled'}`);
    console.log(`    ${h.description}`);
  }
}

async function hooksCreate(sdk: ChaosSDK): Promise<void> {
  const hook = await sdk.hooks.create({
    id: `hook-${Date.now()}`,
    agentId: 'default',
    trigger: { type: 'browser-startup' },
    prompt: 'Summarize my morning bookmarks',
    description: 'Example hook: runs on browser startup',
    enabled: true,
    createdAt: new Date().toISOString(),
    triggerCount: 0,
  });
  console.log(`Created hook: ${hook.id}`);
  console.log(`  trigger: ${hook.trigger.type}`);
  console.log(`  prompt: ${hook.prompt}`);
}

async function usageSummary(sdk: ChaosSDK): Promise<void> {
  const summary = await sdk.usage.getSummary();
  console.log('Usage Summary:');
  console.log(`  Total requests: ${summary.totalRequests}`);
  console.log(`  Total cost: $${summary.totalCost.toFixed(4)}`);
  console.log(`  Input tokens: ${summary.totalInputTokens}`);
  console.log(`  Output tokens: ${summary.totalOutputTokens}`);

  const providerKeys = Object.keys(summary.byProvider);
  if (providerKeys.length > 0) {
    console.log('  By provider:');
    for (const p of providerKeys) {
      const s = summary.byProvider[p];
      console.log(`    ${p}: ${s.requests} requests, $${s.cost.toFixed(4)}`);
    }
  }
}

function showHelp(): void {
  console.log(`chaos — CLI reference implementation for @chaos/sdk

Usage:
  chaos agents list              List all agents
  chaos agents create <name>     Create a new agent
  chaos agents delete <id>       Delete an agent by ID
  chaos chat <agent-id> <msg>    Send a message and stream the response
  chaos hooks list               List all hooks
  chaos hooks create             Create a sample hook
  chaos usage summary            Show usage summary
  chaos help                     Show this help message

Data is stored in ~/.chaos-data/
Uses @chaos/agent-loop with MockModel (no engine connection needed).`);
}

// ── Main ──

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    showHelp();
    return;
  }

  const { sdk, agentStore } = createSDK();
  const [group, command, ...rest] = args;

  switch (group) {
    case 'agents':
      switch (command) {
        case 'list':
          await agentsList(sdk);
          break;
        case 'create': {
          const name = rest.join(' ');
          if (!name) {
            console.error('Usage: chaos agents create <name>');
            process.exit(1);
          }
          await agentsCreate(sdk, agentStore, name);
          break;
        }
        case 'delete': {
          const id = rest[0];
          if (!id) {
            console.error('Usage: chaos agents delete <id>');
            process.exit(1);
          }
          await agentsDelete(sdk, agentStore, id);
          break;
        }
        default:
          console.error(`Unknown agents command: ${command}`);
          showHelp();
          process.exit(1);
      }
      break;

    case 'chat': {
      const agentId = command;
      const message = rest.join(' ');
      if (!agentId || !message) {
        console.error('Usage: chaos chat <agent-id> <message>');
        process.exit(1);
      }
      await chat(sdk, agentId, message);
      break;
    }

    case 'hooks':
      switch (command) {
        case 'list':
          await hooksList(sdk);
          break;
        case 'create':
          await hooksCreate(sdk);
          break;
        default:
          console.error(`Unknown hooks command: ${command}`);
          showHelp();
          process.exit(1);
      }
      break;

    case 'usage':
      switch (command) {
        case 'summary':
          await usageSummary(sdk);
          break;
        default:
          console.error(`Unknown usage command: ${command}`);
          showHelp();
          process.exit(1);
      }
      break;

    default:
      console.error(`Unknown command: ${group}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
