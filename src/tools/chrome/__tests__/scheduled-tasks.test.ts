/**
 * Scheduled Tasks Tests
 *
 * Tests for the scheduled task system: alarm tools store/retrieve
 * ScheduledTask data, and the background handler uses it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScheduledTask } from '../../../storage/types.js';

// ── Mock chrome.* APIs ──

const mockStorageData: Record<string, unknown> = {};

const mockChrome = {
  alarms: {
    create: vi.fn(),
    clear: vi.fn(async () => true),
    getAll: vi.fn(async () => [] as Array<{ name: string; scheduledTime: number; periodInMinutes?: number }>),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorageData[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorageData, obj);
      }),
    },
  },
  permissions: {
    contains: vi.fn(async () => true),
  },
};

vi.stubGlobal('chrome', mockChrome);

const AGENT_ID = 'test-agent';

// Import after mocks are set up
const { createAlarmSet } = await import('../alarm-set.js');
const { createAlarmClear } = await import('../alarm-clear.js');
const { createAlarmList } = await import('../alarm-list.js');
const {
  getScheduledTasks,
  addScheduledTask,
  removeScheduledTask,
  updateScheduledTaskRun,
} = await import('../../../storage/chrome-storage.js');

beforeEach(() => {
  vi.clearAllMocks();
  // Clear storage
  for (const key of Object.keys(mockStorageData)) {
    delete mockStorageData[key];
  }
});

describe('scheduled task storage', () => {
  it('stores and retrieves scheduled tasks', async () => {
    const task: ScheduledTask = {
      alarmId: 'test-agent:daily-report',
      agentId: 'test-agent',
      prompt: 'Check bookmarks and write a summary',
      description: 'Daily bookmark summary',
      createdAt: '2024-01-01T00:00:00.000Z',
      schedule: { type: 'recurring', periodInMinutes: 1440 },
    };

    await addScheduledTask(task);
    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].alarmId).toBe('test-agent:daily-report');
    expect(tasks[0].prompt).toBe('Check bookmarks and write a summary');
  });

  it('replaces a task with the same alarmId', async () => {
    await addScheduledTask({
      alarmId: 'test-agent:task1',
      agentId: 'test-agent',
      prompt: 'Original prompt',
      description: 'Original',
      createdAt: '2024-01-01T00:00:00.000Z',
      schedule: { type: 'once', delayInMinutes: 5 },
    });

    await addScheduledTask({
      alarmId: 'test-agent:task1',
      agentId: 'test-agent',
      prompt: 'Updated prompt',
      description: 'Updated',
      createdAt: '2024-01-02T00:00:00.000Z',
      schedule: { type: 'once', delayInMinutes: 10 },
    });

    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prompt).toBe('Updated prompt');
  });

  it('removes a scheduled task', async () => {
    await addScheduledTask({
      alarmId: 'test-agent:to-remove',
      agentId: 'test-agent',
      prompt: 'Some task',
      description: 'Remove me',
      createdAt: '2024-01-01T00:00:00.000Z',
      schedule: { type: 'once', delayInMinutes: 1 },
    });

    await removeScheduledTask('test-agent:to-remove');
    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(0);
  });

  it('updates lastRunAt and lastResult', async () => {
    await addScheduledTask({
      alarmId: 'test-agent:run-me',
      agentId: 'test-agent',
      prompt: 'Do work',
      description: 'Runnable',
      createdAt: '2024-01-01T00:00:00.000Z',
      schedule: { type: 'recurring', periodInMinutes: 60 },
    });

    await updateScheduledTaskRun('test-agent:run-me', 'Task completed successfully');

    const tasks = await getScheduledTasks();
    expect(tasks[0].lastRunAt).toBeDefined();
    expect(tasks[0].lastResult).toBe('Task completed successfully');
  });
});

describe('alarm_set with prompt', () => {
  it('stores a ScheduledTask when prompt is provided', async () => {
    mockChrome.alarms.create.mockResolvedValue(undefined);

    const alarmSet = createAlarmSet(AGENT_ID);
    const result = await alarmSet.execute!(
      {
        name: 'daily-report',
        periodInMinutes: 1440,
        delayInMinutes: undefined,
        prompt: 'Check my bookmarks and write a daily summary',
        description: 'Daily bookmark summary',
      },
      { toolCallId: 'test', messages: [] },
    );

    // Alarm was created
    expect(mockChrome.alarms.create).toHaveBeenCalledWith(
      `${AGENT_ID}:daily-report`,
      { periodInMinutes: 1440 },
    );

    // Result indicates prompt was stored
    expect(result).toHaveProperty('prompt', '(stored)');

    // ScheduledTask was stored
    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].alarmId).toBe(`${AGENT_ID}:daily-report`);
    expect(tasks[0].prompt).toBe('Check my bookmarks and write a daily summary');
    expect(tasks[0].description).toBe('Daily bookmark summary');
    expect(tasks[0].schedule.type).toBe('recurring');
    expect(tasks[0].schedule.periodInMinutes).toBe(1440);
  });

  it('does not store a ScheduledTask when no prompt provided', async () => {
    mockChrome.alarms.create.mockResolvedValue(undefined);

    const alarmSet = createAlarmSet(AGENT_ID);
    await alarmSet.execute!(
      {
        name: 'no-prompt',
        delayInMinutes: 5,
        periodInMinutes: undefined,
        prompt: undefined,
        description: undefined,
      },
      { toolCallId: 'test', messages: [] },
    );

    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(0);
  });

  it('uses alarm name as description when description not provided', async () => {
    mockChrome.alarms.create.mockResolvedValue(undefined);

    const alarmSet = createAlarmSet(AGENT_ID);
    await alarmSet.execute!(
      {
        name: 'my-task',
        delayInMinutes: 10,
        periodInMinutes: undefined,
        prompt: 'Do something',
        description: undefined,
      },
      { toolCallId: 'test', messages: [] },
    );

    const tasks = await getScheduledTasks();
    expect(tasks[0].description).toBe('my-task');
  });
});

describe('alarm_clear removes ScheduledTask', () => {
  it('removes the ScheduledTask when clearing an alarm', async () => {
    // Pre-populate a task
    await addScheduledTask({
      alarmId: `${AGENT_ID}:to-clear`,
      agentId: AGENT_ID,
      prompt: 'Some task',
      description: 'Clear me',
      createdAt: '2024-01-01T00:00:00.000Z',
      schedule: { type: 'once', delayInMinutes: 5 },
    });

    mockChrome.alarms.clear.mockResolvedValue(true);

    const alarmClear = createAlarmClear(AGENT_ID);
    const result = await alarmClear.execute!(
      { name: 'to-clear' },
      { toolCallId: 'test', messages: [] },
    );

    expect(result).toEqual({ name: `${AGENT_ID}:to-clear`, cleared: true });

    // Task should be removed
    const tasks = await getScheduledTasks();
    expect(tasks).toHaveLength(0);
  });
});

describe('alarm_list includes prompt and description', () => {
  it('enriches alarm list with scheduled task data', async () => {
    // Pre-populate a task
    await addScheduledTask({
      alarmId: `${AGENT_ID}:enriched`,
      agentId: AGENT_ID,
      prompt: 'Run enriched task',
      description: 'Enriched task',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: '2024-01-02T00:00:00.000Z',
      lastResult: 'Completed ok',
      schedule: { type: 'recurring', periodInMinutes: 60 },
    });

    mockChrome.alarms.getAll.mockResolvedValue([
      {
        name: `${AGENT_ID}:enriched`,
        scheduledTime: 1700000000000,
        periodInMinutes: 60,
      },
      {
        name: 'other-agent:something',
        scheduledTime: 1700001000000,
      },
    ]);

    const alarmList = createAlarmList(AGENT_ID);
    const result = (await alarmList.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    )) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Run enriched task');
    expect(result[0].description).toBe('Enriched task');
    expect(result[0].lastRunAt).toBe('2024-01-02T00:00:00.000Z');
    expect(result[0].lastResult).toBe('Completed ok');
  });

  it('returns undefined for prompt when no scheduled task exists', async () => {
    mockChrome.alarms.getAll.mockResolvedValue([
      {
        name: `${AGENT_ID}:no-task`,
        scheduledTime: 1700000000000,
      },
    ]);

    const alarmList = createAlarmList(AGENT_ID);
    const result = (await alarmList.execute!(
      {},
      { toolCallId: 'test', messages: [] },
    )) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBeUndefined();
    expect(result[0].description).toBeUndefined();
  });
});
