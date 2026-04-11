/**
 * Tests for set_agent_schedule master tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSetAgentScheduleTool } from '../set-agent-schedule.js';

// ── Mocks ──

const mockAgents = [
  { id: 'master-1', name: 'Master' },
  { id: 'researcher', name: 'Researcher' },
];

const addScheduledTaskSpy = vi.fn<(task: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);

vi.mock('../../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(() => Promise.resolve(mockAgents)),
  addScheduledTask: (task: Record<string, unknown>) => addScheduledTaskSpy(task),
}));

// Mock chrome.alarms
const createAlarmSpy = vi.fn(() => Promise.resolve());
vi.stubGlobal('chrome', {
  alarms: {
    create: createAlarmSpy,
  },
});

// ── Tests ──

describe('set_agent_schedule tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a recurring schedule for a target agent', async () => {
    const tool = createSetAgentScheduleTool('master-1');
    const result = await (tool as any).execute({
      agentId: 'researcher',
      name: 'daily-summary',
      prompt: 'Generate a daily summary of research findings',
      description: 'Daily research summary',
      periodInMinutes: 1440,
    });

    expect(result.ok).toBe(true);
    expect(result.alarmName).toBe('researcher:daily-summary');
    expect(result.agentId).toBe('researcher');
    expect(result.agentName).toBe('Researcher');
    expect(result.scheduleType).toBe('recurring');
    expect(result.periodInMinutes).toBe(1440);

    // Verify chrome alarm was created with correct namespace
    expect(createAlarmSpy).toHaveBeenCalledWith('researcher:daily-summary', {
      periodInMinutes: 1440,
    });

    // Verify scheduled task is scoped to the target agent
    expect(addScheduledTaskSpy).toHaveBeenCalledTimes(1);
    const task = addScheduledTaskSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(task['agentId']).toBe('researcher');
    expect(task['prompt']).toBe('Generate a daily summary of research findings');
    expect((task['schedule'] as Record<string, unknown>)['type']).toBe('recurring');
  });

  it('creates a one-time schedule with delay', async () => {
    const tool = createSetAgentScheduleTool('master-1');
    const result = await (tool as any).execute({
      agentId: 'researcher',
      name: 'one-off-check',
      prompt: 'Check for new papers on arxiv',
      description: 'One-time check',
      delayInMinutes: 30,
    });

    expect(result.ok).toBe(true);
    expect(result.scheduleType).toBe('once');
    expect(createAlarmSpy).toHaveBeenCalledWith('researcher:one-off-check', {
      delayInMinutes: 30,
    });
  });

  it('defaults to 1 minute delay when no timing specified', async () => {
    const tool = createSetAgentScheduleTool('master-1');
    await (tool as any).execute({
      agentId: 'researcher',
      name: 'asap-task',
      prompt: 'Do this now',
      description: 'Immediate task',
    });

    expect(createAlarmSpy).toHaveBeenCalledWith('researcher:asap-task', {
      delayInMinutes: 1,
    });
  });

  it('returns error for non-existent agent', async () => {
    const tool = createSetAgentScheduleTool('master-1');
    const result = await (tool as any).execute({
      agentId: 'nonexistent',
      name: 'test',
      prompt: 'Test',
      description: 'Test',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('nonexistent');
    expect(createAlarmSpy).not.toHaveBeenCalled();
    expect(addScheduledTaskSpy).not.toHaveBeenCalled();
  });
});
