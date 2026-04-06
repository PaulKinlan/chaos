/**
 * Tests for the Agentic Loop.
 *
 * Mocks the AI SDK, OPFS, and Chrome storage to verify multi-step
 * autonomous execution, tool call continuation, completion detection,
 * max iteration limits, abort signal handling, and progress updates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock state ──

const mockFiles: Record<string, string> = {};

// ── OPFS mock ──

vi.mock('../../storage/opfs.js', () => ({
  opfs: {
    readFile: vi.fn(async (path: string) => {
      if (path in mockFiles) return mockFiles[path];
      throw new Error(`File not found: ${path}`);
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      mockFiles[path] = content;
    }),
    appendFile: vi.fn(async (path: string, content: string) => {
      mockFiles[path] = (mockFiles[path] ?? '') + content;
    }),
    readLines: vi.fn(async (path: string, lastN?: number) => {
      if (!(path in mockFiles)) throw new Error(`File not found: ${path}`);
      const lines = mockFiles[path].split('\n').filter((l) => l.length > 0);
      if (lastN !== undefined && lastN > 0) return lines.slice(-lastN);
      return lines;
    }),
    listDir: vi.fn(async () => ['CLAUDE.md', 'memories']),
    mkdir: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
  OPFS: vi.fn(),
}));

// ── Chrome storage mock ──

const mockAgents = [
  {
    id: 'test-agent-1',
    name: 'TestBot',
    role: 'neutral',
    visibility: 'visible' as const,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

vi.mock('../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(async () => mockAgents),
  setAgentList: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({
    activeProvider: 'anthropic',
    theme: 'system',
  })),
  getApiKeys: vi.fn(async () => ({
    anthropic: 'test-api-key',
  })),
}));

// ── AI SDK mock ──

// Track streamText calls and allow configuring responses per call
let streamTextCallCount = 0;
let streamTextResponses: Array<{
  text: string;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
}> = [];

vi.mock('ai', () => ({
  streamText: vi.fn(() => {
    const idx = streamTextCallCount++;
    const resp = streamTextResponses[idx] ?? { text: 'Done.' };
    const toolCalls = resp.toolCalls || [];

    // Create an async iterable for fullStream
    async function* mockFullStream() {
      // Yield text deltas
      if (resp.text) {
        yield { type: 'text-delta' as const, text: resp.text };
      }
      // Yield tool calls
      for (const tc of toolCalls) {
        yield { type: 'tool-call' as const, toolName: tc.toolName, toolCallId: `tc-${idx}`, args: tc.args };
      }
    }

    return {
      fullStream: mockFullStream(),
      text: Promise.resolve(resp.text),
      response: Promise.resolve({
        messages: [{ role: 'assistant', content: resp.text }],
      }),
    };
  }),
  tool: vi.fn((config: any) => config),
  stepCountIs: vi.fn((count: number) => ({ type: 'stepCount', count })),
}));

// ── Provider registry mock ──

const mockModel = { modelId: 'claude-sonnet-4-6' };

vi.mock('../provider-registry.js', () => ({
  createLanguageModel: vi.fn(() => mockModel),
  getProviderSearchTools: vi.fn(() => ({})),
  getProvider: vi.fn(() => ({ defaultModel: 'claude-sonnet-4-6' })),
}));

// ── Tools mocks ──

vi.mock('../../tools/communication/index.js', () => ({
  getCommunicationTools: vi.fn(() => ({})),
}));

vi.mock('../../tools/chrome/index.js', () => ({
  getChromeTools: vi.fn(async () => ({})),
}));

vi.mock('../../tools/wasm/index.js', () => ({
  getWasmTools: vi.fn(async () => ({})),
}));

vi.mock('../../tools/web/index.js', () => ({
  getWebTools: vi.fn(() => ({})),
}));

vi.mock('../../tools/hooks/index.js', () => ({
  getHookTools: vi.fn(() => ({})),
}));

vi.mock('../../tools/permissions.js', () => ({
  checkPermission: vi.fn(async () => true),
}));

vi.mock('../../tools/master/index.js', () => ({
  getMasterTools: vi.fn(() => ({})),
}));

vi.mock('../../tools/skills/index.js', () => ({
  getSkillTools: vi.fn(() => ({})),
}));

vi.mock('../skills.js', () => ({
  buildSkillsPromptSection: vi.fn(async () => ''),
}));

// ── Import after mocks ──

import { runAgenticLoop, type ProgressUpdate } from '../agentic-loop.js';

// ── Setup ──

beforeEach(() => {
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  streamTextCallCount = 0;
  streamTextResponses = [];
  vi.clearAllMocks();

  // Set up agent CLAUDE.md
  mockFiles['agents/test-agent-1/CLAUDE.md'] = '# TestBot\n\nYou are TestBot, a helpful agent.';

  // Install chrome global
  (globalThis as any).chrome = {
    storage: {
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
    permissions: { contains: vi.fn(async () => false) },
  };
});

// ── Tests ──

describe('runAgenticLoop', () => {
  it('completes immediately when no tool calls are made', async () => {
    streamTextResponses = [
      {
        text: 'Task complete. Here is the summary.',
        
      },
    ];

    const result = await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Summarize everything.',
    });

    expect(result).toBe('Task complete. Here is the summary.');
    const { streamText } = await import('ai');
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
  });

  it('continues the loop when tools are called, stops when no tools', async () => {
    streamTextResponses = [
      // Step 1: tool call
      {
        text: '',
        toolCalls: [{ toolName: 'read_file', args: { path: 'data.md' } }],
      },
      // Step 2: another tool call
      {
        text: 'Intermediate thoughts.',
        toolCalls: [{ toolName: 'write_file', args: { path: 'out.md', content: 'result' } }],
      },
      // Step 3: no tool calls — done
      {
        text: 'All done. Report written.',
        
      },
    ];

    const result = await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Research and write a report.',
    });

    expect(result).toBe('All done. Report written.');
    const { streamText } = await import('ai');
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(3);
  });

  it('respects max iteration limit', async () => {
    // All responses have tool calls — will hit the limit
    streamTextResponses = Array.from({ length: 5 }, () => ({
      text: 'Still working...',
      toolCalls: [{ toolName: 'read_file', args: { path: 'x.md' } }],
    }));

    const result = await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Infinite task',
      maxIterations: 3,
    });

    expect(result).toBe('Still working...');
    const { streamText } = await import('ai');
    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(3);
  });

  it('handles abort signal cancellation', async () => {
    const controller = new AbortController();
    // Abort before it even runs
    controller.abort();

    const progress: ProgressUpdate[] = [];
    const result = await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Do something',
      signal: controller.signal,
      onProgress: (update) => progress.push(update),
    });

    // Should have reported error and returned empty
    expect(progress.some((p) => p.type === 'error' && p.content === 'Aborted')).toBe(true);
    expect(result).toBe('');
    const { streamText } = await import('ai');
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
  });

  it('fires progress updates correctly', async () => {
    streamTextResponses = [
      {
        text: '',
        toolCalls: [{ toolName: 'read_file', args: { path: 'a.md' } }],
      },
      {
        text: 'Final answer.',
        
      },
    ];

    const progress: ProgressUpdate[] = [];
    await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Do research',
      onProgress: (update) => progress.push(update),
    });

    // Check we got the expected progress types
    const types = progress.map((p) => p.type);
    expect(types).toContain('thinking');
    expect(types).toContain('tool-call');
    expect(types).toContain('step-complete');
    expect(types).toContain('done');

    // Check iteration numbers
    const thinkingUpdates = progress.filter((p) => p.type === 'thinking');
    expect(thinkingUpdates[0].iteration).toBe(1);
    expect(thinkingUpdates[1].iteration).toBe(2);

    // Check tool-call has toolName
    const toolCallUpdate = progress.find((p) => p.type === 'tool-call');
    expect(toolCallUpdate?.toolName).toBe('read_file');

    // Check done has final text
    const doneUpdate = progress.find((p) => p.type === 'done');
    expect(doneUpdate?.content).toBe('Final answer.');
  });

  it('throws when agent CLAUDE.md is missing', async () => {
    await expect(
      runAgenticLoop({
        agentId: 'nonexistent-agent',
        task: 'Hello',
      }),
    ).rejects.toThrow('Agent not found or missing CLAUDE.md');
  });

  it('throws when no API key is configured', async () => {
    const { getApiKeys } = await import('../../storage/chrome-storage.js');
    vi.mocked(getApiKeys).mockResolvedValueOnce({});

    await expect(
      runAgenticLoop({
        agentId: 'test-agent-1',
        task: 'Hello',
      }),
    ).rejects.toThrow('No API key configured for provider');
  });

  it('reports max-iteration error via onProgress', async () => {
    streamTextResponses = Array.from({ length: 3 }, () => ({
      text: 'Working...',
      toolCalls: [{ toolName: 'read_file', args: { path: 'x.md' } }],
    }));

    const progress: ProgressUpdate[] = [];
    await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Run forever',
      maxIterations: 2,
      onProgress: (update) => progress.push(update),
    });

    const errorUpdate = progress.find((p) => p.type === 'error');
    expect(errorUpdate).toBeDefined();
    expect(errorUpdate?.content).toContain('maximum');
    expect(errorUpdate?.content).toContain('2');
  });

  it('logs activity for agentic tasks', async () => {
    streamTextResponses = [
      {
        text: 'Done with task.',
        
      },
    ];

    await runAgenticLoop({
      agentId: 'test-agent-1',
      task: 'Do something',
    });

    // Check activity log was written
    const logPath = 'agents/test-agent-1/activity-log.jsonl';
    expect(mockFiles[logPath]).toBeDefined();
    const lines = mockFiles[logPath].trim().split('\n');
    expect(lines.length).toBe(2); // user entry + assistant entry

    const userEntry = JSON.parse(lines[0]);
    expect(userEntry.role).toBe('user');
    expect(userEntry.summary).toContain('[Agentic]');

    const assistantEntry = JSON.parse(lines[1]);
    expect(assistantEntry.role).toBe('assistant');
    expect(assistantEntry.summary).toContain('[Agentic]');
  });
});
