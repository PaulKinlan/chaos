/**
 * Tests for the Agent Loop.
 *
 * Mocks the AI SDK, OPFS, and Chrome storage to test that the loop
 * assembles the correct system prompt and handles tool calls.
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
    listDir: vi.fn(async () => ['CLAUDE.md', 'memories', 'TODO.md']),
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

// Track what streamText receives
let capturedStreamTextArgs: any = null;

// Create an async generator that yields text deltas
async function* mockFullStream() {
  yield { type: 'text-delta' as const, textDelta: 'Hello, ' };
  yield { type: 'text-delta' as const, textDelta: 'I am TestBot!' };
}

vi.mock('ai', () => ({
  streamText: vi.fn((args: any) => {
    capturedStreamTextArgs = args;
    return {
      fullStream: mockFullStream(),
    };
  }),
  tool: vi.fn((config: any) => config),
}));

// ── Provider registry mock ──

const mockModel = { modelId: 'claude-sonnet-4-6' };

vi.mock('../provider-registry.js', () => ({
  createLanguageModel: vi.fn(() => mockModel),
}));

// ── Import after mocks ──

import { runAgentLoop } from '../loop.js';

// ── Setup ──

beforeEach(() => {
  // Clear state
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  capturedStreamTextArgs = null;
  vi.clearAllMocks();

  // Set up agent CLAUDE.md
  mockFiles['agents/test-agent-1/CLAUDE.md'] = '# TestBot\n\nYou are TestBot, a helpful agent.';

  // Install chrome global
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
    },
  };
});

describe('Agent Loop', () => {
  describe('runAgentLoop', () => {
    it('returns the full response text', async () => {
      const result = await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      expect(result).toBe('Hello, I am TestBot!');
    });

    it('includes CLAUDE.md in the system prompt', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      expect(capturedStreamTextArgs.system).toContain('You are TestBot');
    });

    it('includes page context in the system prompt when provided', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Summarize this page',
        pageContext: {
          title: 'Test Page',
          url: 'https://example.com',
          content: 'This is the page content.',
        },
      });

      expect(capturedStreamTextArgs.system).toContain('Test Page');
      expect(capturedStreamTextArgs.system).toContain('https://example.com');
      expect(capturedStreamTextArgs.system).toContain('This is the page content.');
    });

    it('includes activity journal in system prompt when available', async () => {
      mockFiles['agents/test-agent-1/activity-log.jsonl'] =
        '{"timestamp":"2026-01-01T00:00:00Z","role":"user","summary":"Previous message"}\n';

      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      expect(capturedStreamTextArgs.system).toContain('Recent Activity');
      expect(capturedStreamTextArgs.system).toContain('Previous message');
    });

    it('calls onChunk for each text delta', async () => {
      const chunks: string[] = [];

      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
        onChunk: (chunk) => chunks.push(chunk),
      });

      expect(chunks).toEqual(['Hello, ', 'I am TestBot!']);
    });

    it('passes the user message in the messages array', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'What can you do?',
      });

      expect(capturedStreamTextArgs.messages).toEqual([
        { role: 'user', content: 'What can you do?' },
      ]);
    });

    it('provides file tools to the model', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      const toolNames = Object.keys(capturedStreamTextArgs.tools);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('list_directory');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('mkdir');
      expect(toolNames).toContain('append_file');
    });

    it('sets maxSteps for multi-step tool use', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      expect(capturedStreamTextArgs.maxSteps).toBe(10);
    });

    it('appends to activity log after interaction', async () => {
      await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Hello!',
      });

      const log = mockFiles['agents/test-agent-1/activity-log.jsonl'];
      expect(log).toBeTruthy();

      const lines = log.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(2); // user + assistant

      const userEntry = JSON.parse(lines[0]);
      expect(userEntry.role).toBe('user');
      expect(userEntry.summary).toBe('Hello!');

      const assistantEntry = JSON.parse(lines[1]);
      expect(assistantEntry.role).toBe('assistant');
      expect(assistantEntry.summary).toContain('Hello, I am TestBot!');
    });

    it('throws when CLAUDE.md is missing', async () => {
      await expect(
        runAgentLoop({
          agentId: 'nonexistent-agent',
          userMessage: 'Hello!',
        }),
      ).rejects.toThrow('Agent not found or missing CLAUDE.md');
    });

    it('throws when no API key is configured', async () => {
      const { getApiKeys } = await import('../../storage/chrome-storage.js');
      vi.mocked(getApiKeys).mockResolvedValueOnce({});

      await expect(
        runAgentLoop({
          agentId: 'test-agent-1',
          userMessage: 'Hello!',
        }),
      ).rejects.toThrow('No API key configured');
    });

    it('handles tool calls in the stream', async () => {
      // Override the mock to include a tool call
      const { streamText } = await import('ai');
      vi.mocked(streamText).mockReturnValueOnce({
        fullStream: (async function* () {
          yield { type: 'tool-call' as const, toolName: 'read_file', toolCallId: '1', args: { path: 'CLAUDE.md' } };
          yield { type: 'text-delta' as const, textDelta: 'I read the file.' };
        })(),
      } as any);

      const result = await runAgentLoop({
        agentId: 'test-agent-1',
        userMessage: 'Read your CLAUDE.md',
      });

      expect(result).toBe('I read the file.');

      // Check that tool call was logged
      const log = mockFiles['agents/test-agent-1/activity-log.jsonl'];
      const lines = log.split('\n').filter((l) => l.length > 0);
      const assistantEntry = JSON.parse(lines[lines.length - 1]);
      expect(assistantEntry.toolCalls).toEqual(['read_file']);
    });
  });
});
