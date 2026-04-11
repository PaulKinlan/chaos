/**
 * Tests for set_agent_hook master tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSetAgentHookTool } from '../set-agent-hook.js';

// ── Mocks ──

const mockAgents = [
  { id: 'master-1', name: 'Master' },
  { id: 'researcher', name: 'Researcher' },
  { id: 'writer', name: 'Writer' },
];

const addHookSpy = vi.fn<(hook: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);

vi.mock('../../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(() => Promise.resolve(mockAgents)),
  addHook: (hook: Record<string, unknown>) => addHookSpy(hook),
}));

// ── Tests ──

describe('set_agent_hook tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a hook for a target agent', async () => {
    const tool = createSetAgentHookTool('master-1');
    const result = await (tool as any).execute({
      agentId: 'researcher',
      trigger: { type: 'tab-navigated', urlPattern: '*://arxiv.org/*' },
      prompt: 'Summarize this research paper',
      description: 'Auto-summarize arxiv papers',
    });

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('researcher');
    expect(result.agentName).toBe('Researcher');
    expect(result.trigger).toBe('tab-navigated');
    expect(result.hookId).toMatch(/^hook-/);

    // Verify the hook was created with the target agent's ID, not the master's
    expect(addHookSpy).toHaveBeenCalledTimes(1);
    const createdHook = addHookSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(createdHook['agentId']).toBe('researcher');
    expect(createdHook['prompt']).toBe('Summarize this research paper');
    expect(createdHook['enabled']).toBe(true);
  });

  it('returns error for non-existent agent', async () => {
    const tool = createSetAgentHookTool('master-1');
    const result = await (tool as any).execute({
      agentId: 'nonexistent',
      trigger: { type: 'browser-startup' },
      prompt: 'Do something',
      description: 'Startup hook',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('nonexistent');
    expect(addHookSpy).not.toHaveBeenCalled();
  });

  it('supports all trigger types', async () => {
    const tool = createSetAgentHookTool('master-1');

    const triggers = [
      { type: 'bookmark-created' as const },
      { type: 'tab-created' as const },
      { type: 'tab-closed' as const },
      { type: 'download-completed' as const },
      { type: 'browser-startup' as const },
      { type: 'idle-changed' as const, state: 'idle' as const },
    ];

    for (const trigger of triggers) {
      addHookSpy.mockClear();
      const result = await (tool as any).execute({
        agentId: 'writer',
        trigger,
        prompt: 'Handle this event',
        description: `Hook for ${trigger.type}`,
      });
      expect(result.ok).toBe(true);
      expect(addHookSpy).toHaveBeenCalledTimes(1);
    }
  });
});
