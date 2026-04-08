/**
 * Testing utilities for @chaos/agent-loop.
 *
 * Provides a createMockModel that wraps the AI SDK's MockLanguageModelV3
 * with a simpler interface for predetermined responses.
 */

import {
  MockLanguageModelV3,
  convertArrayToReadableStream,
} from 'ai/test';

export interface MockResponse {
  text?: string;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }>;
}

export interface MockModelOptions {
  /** Predetermined responses. response[0] for call 1, response[1] for call 2, etc. */
  responses: MockResponse[];
  /** Model ID for logging. Defaults to 'mock-model'. */
  modelId?: string;
  /** Provider name for logging. Defaults to 'mock-provider'. */
  provider?: string;
  /** Simulated input tokens per call. Defaults to 10. */
  inputTokensPerCall?: number;
  /** Simulated output tokens per call. Defaults to 20. */
  outputTokensPerCall?: number;
}

function buildStreamParts(
  response: MockResponse,
  callIndex: number,
  inputTokens: number,
  outputTokens: number,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  // Stream start
  parts.push({ type: 'stream-start', warnings: [] });

  // Response metadata
  parts.push({
    type: 'response-metadata',
    id: `resp-${callIndex}`,
    timestamp: new Date(),
    modelId: 'mock-model',
  });

  if (response?.text) {
    const textId = `text-${callIndex}`;
    parts.push({ type: 'text-start', id: textId });
    parts.push({ type: 'text-delta', id: textId, delta: response.text });
    parts.push({ type: 'text-end', id: textId });
  }

  if (response?.toolCalls) {
    for (const tc of response.toolCalls) {
      const toolId = `call-${callIndex}-${tc.toolName}`;
      parts.push({
        type: 'tool-input-start',
        id: toolId,
        toolName: tc.toolName,
      });
      parts.push({
        type: 'tool-input-delta',
        id: toolId,
        delta: JSON.stringify(tc.args),
      });
      parts.push({ type: 'tool-input-end', id: toolId });
      // Emit the resolved tool-call (same as real providers do after input streaming)
      parts.push({
        type: 'tool-call',
        toolCallId: toolId,
        toolName: tc.toolName,
        input: JSON.stringify(tc.args),
      });
    }
  }

  parts.push({
    type: 'finish',
    finishReason: response?.toolCalls?.length ? 'tool-calls' : 'stop',
    usage: { inputTokens, outputTokens },
  });

  return parts;
}

function buildGenerateContent(
  response: MockResponse,
  callIndex: number,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  if (response?.text) {
    content.push({ type: 'text', text: response.text });
  }

  if (response?.toolCalls) {
    for (const tc of response.toolCalls) {
      content.push({
        type: 'tool-call',
        toolCallId: `call-${callIndex}-${tc.toolName}`,
        toolName: tc.toolName,
        input: JSON.stringify(tc.args),
      });
    }
  }

  return content;
}

/**
 * Create a mock LanguageModel that returns predetermined responses.
 * Works with both streamText() and generateText() from the Vercel AI SDK.
 *
 * Uses the AI SDK's built-in MockLanguageModelV3.
 */
export function createMockModel(options: MockModelOptions) {
  let callIndex = 0;
  const modelId = options.modelId ?? 'mock-model';
  const provider = options.provider ?? 'mock-provider';
  const inputTokens = options.inputTokensPerCall ?? 10;
  const outputTokens = options.outputTokensPerCall ?? 20;

  return new MockLanguageModelV3({
    provider,
    modelId,
    doGenerate: async () => {
      const responseIndex = Math.min(
        callIndex,
        options.responses.length - 1,
      );
      const response = options.responses[responseIndex];
      callIndex++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        content: buildGenerateContent(response, callIndex),
        finishReason: response?.toolCalls?.length
          ? 'tool-calls'
          : 'stop',
        usage: { inputTokens, outputTokens },
        warnings: [],
      } as any;
    },
    doStream: async () => {
      const responseIndex = Math.min(
        callIndex,
        options.responses.length - 1,
      );
      const response = options.responses[responseIndex];
      callIndex++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        stream: convertArrayToReadableStream(
          buildStreamParts(
            response,
            callIndex,
            inputTokens,
            outputTokens,
          ) as any[],
        ),
      } as any;
    },
  });
}
