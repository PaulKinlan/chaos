/**
 * Resolve a LanguageModel from CLI args or fall back to mock.
 *
 * Usage: npx tsx examples/basic-agent.ts --provider anthropic
 *        npx tsx examples/basic-agent.ts --provider google
 *        npx tsx examples/basic-agent.ts --provider openai
 *        npx tsx examples/basic-agent.ts  (uses mock)
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - for --provider anthropic
 *   GOOGLE_API_KEY    - for --provider google
 *   OPENAI_API_KEY    - for --provider openai
 *
 * Optional: --model=<model-id> to override the default model for a provider.
 */

import type { LanguageModel } from 'ai';

export async function resolveModel(
  mockResponses?: Array<{
    text?: string;
    toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>;
  }>,
): Promise<LanguageModel> {
  const providerArg =
    process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ||
    (process.argv.includes('--provider')
      ? process.argv[process.argv.indexOf('--provider') + 1]
      : undefined);

  if (!providerArg) {
    // Default to mock
    const { createMockModel } = await import('agent-do/testing');
    return createMockModel({
      responses: mockResponses || [{ text: 'Mock response.' }],
    }) as LanguageModel;
  }

  const modelArg = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1];

  switch (providerArg) {
    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('Set ANTHROPIC_API_KEY environment variable');
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const model = modelArg || 'claude-sonnet-4-6';
      console.log(`Using Anthropic: ${model}`);
      return createAnthropic({ apiKey: key })(model) as unknown as LanguageModel;
    }
    case 'google': {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) throw new Error('Set GOOGLE_API_KEY environment variable');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const model = modelArg || 'gemini-2.5-flash';
      console.log(`Using Google: ${model}`);
      return createGoogleGenerativeAI({ apiKey: key })(model) as unknown as LanguageModel;
    }
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('Set OPENAI_API_KEY environment variable');
      const { createOpenAI } = await import('@ai-sdk/openai');
      const model = modelArg || 'gpt-4.1-mini';
      console.log(`Using OpenAI: ${model}`);
      return createOpenAI({ apiKey: key })(model) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown provider: ${providerArg}. Use: anthropic, google, openai`);
  }
}

/** Returns true if a real (non-mock) provider was specified on the CLI. */
export function isRealProvider(): boolean {
  return (
    process.argv.some((a) => a.startsWith('--provider=')) ||
    process.argv.includes('--provider')
  );
}
