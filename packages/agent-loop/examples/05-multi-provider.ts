/**
 * Example 5: Multiple Providers
 *
 * The agent loop is provider-agnostic. Use any model that implements
 * the Vercel AI SDK LanguageModel interface.
 *
 * Run: npx tsx examples/05-multi-provider.ts
 */

import { createAgent } from '@chaos/agent-loop';

// ── Anthropic (Claude) ──
async function withAnthropic() {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })('claude-sonnet-4-6');

  const agent = createAgent({
    id: 'claude-agent',
    name: 'Claude',
    model: model as any,
    systemPrompt: 'Be concise.',
  });
  return agent.run('What is 2+2?');
}

// ── Google (Gemini) ──
async function withGoogle() {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const model = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY! })('gemini-2.5-flash');

  const agent = createAgent({
    id: 'gemini-agent',
    name: 'Gemini',
    model: model as any,
    systemPrompt: 'Be concise.',
  });
  return agent.run('What is 2+2?');
}

// ── OpenAI (GPT) ──
async function withOpenAI() {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })('gpt-4.1-mini');

  const agent = createAgent({
    id: 'gpt-agent',
    name: 'GPT',
    model: model as any,
    systemPrompt: 'Be concise.',
  });
  return agent.run('What is 2+2?');
}

// ── Ollama (local) ──
async function withOllama() {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const model = createOpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  })('llama3.2');

  const agent = createAgent({
    id: 'ollama-agent',
    name: 'Llama',
    model: model as any,
    systemPrompt: 'Be concise.',
  });
  return agent.run('What is 2+2?');
}

// Run whichever provider you have configured
const provider = process.argv[2] || 'anthropic';
const runners: Record<string, () => Promise<string>> = {
  anthropic: withAnthropic,
  google: withGoogle,
  openai: withOpenAI,
  ollama: withOllama,
};

const result = await runners[provider]!();
console.log(`[${provider}] ${result}`);
