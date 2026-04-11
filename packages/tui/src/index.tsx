#!/usr/bin/env node
/**
 * CHAOS TUI — Multi-agent terminal interface.
 *
 * Usage:
 *   npx tsx src/index.tsx [--provider anthropic] [--model claude-sonnet-4-6]
 *
 * Environment:
 *   ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY
 *   CHAOS_PROVIDER (default: anthropic)
 *   CHAOS_MODEL (default: depends on provider)
 */

import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { resolveModel, parseFlag } from './model.js';

async function main() {
  // Help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
CHAOS TUI — Multi-agent terminal interface

Usage:
  chaos-tui [options]

Options:
  --provider <name>   Model provider: anthropic, google, openai, ollama (default: anthropic)
  --model <id>        Model ID (default: provider-specific)
  --agent <name>      Initial agent name (can be repeated for multiple columns)
  --help              Show this help

Keybindings:
  Tab / Shift+Tab     Switch between agent columns
  Ctrl+N              Create a new agent column
  Ctrl+D              Delete the focused agent
  Esc                 Abort current generation
  Ctrl+C              Quit

Environment:
  ANTHROPIC_API_KEY   API key for Anthropic (Claude)
  GOOGLE_API_KEY      API key for Google (Gemini)
  OPENAI_API_KEY      API key for OpenAI (GPT)
  OLLAMA_URL          Ollama server URL (default: http://localhost:11434/v1)
  CHAOS_PROVIDER      Default provider
  CHAOS_MODEL         Default model
`);
    process.exit(0);
  }

  const provider = parseFlag('provider') || process.env.CHAOS_PROVIDER || 'anthropic';
  const modelId = parseFlag('model') || process.env.CHAOS_MODEL || '';

  console.log(`Connecting to ${provider}...`);

  let model;
  try {
    model = await resolveModel();
  } catch (err) {
    console.error(`Failed to initialize model: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`\nSet the appropriate API key environment variable or use --provider to switch.`);
    process.exit(1);
  }

  // Parse --agent flags for initial agents
  const initialAgents: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--agent' && process.argv[i + 1]) {
      const name = process.argv[i + 1]!;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      initialAgents.push({ id, name });
    }
  }

  console.clear();

  const { waitUntilExit } = render(
    <App
      model={model}
      provider={provider}
      modelId={modelId || '(default)'}
      initialAgents={initialAgents.length > 0 ? initialAgents : undefined}
    />,
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
