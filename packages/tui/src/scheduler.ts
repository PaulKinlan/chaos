/**
 * Task Scheduler — cron-like system for the TUI.
 *
 * Agents can create scheduled tasks via the schedule_task tool.
 * Tasks run at intervals while the TUI is open. Each execution
 * opens a new column so the user can see the output.
 *
 * Persisted to .chaos/schedules.json so they survive restarts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const SCHEDULES_FILE = path.join(BASE_DIR, 'schedules.json');

export interface ScheduledTask {
  id: string;
  agentId: string;
  prompt: string;
  description: string;
  intervalMinutes: number;
  createdAt: string;
  lastRunAt?: string;
  enabled: boolean;
}

// ── Persistence ──

function ensureDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

export function loadSchedules(): ScheduledTask[] {
  ensureDir();
  if (!fs.existsSync(SCHEDULES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveSchedules(tasks: ScheduledTask[]): void {
  ensureDir();
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

export function addSchedule(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'enabled'>): ScheduledTask {
  const schedule: ScheduledTask = {
    ...task,
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
  const all = loadSchedules();
  all.push(schedule);
  saveSchedules(all);
  return schedule;
}

export function removeSchedule(id: string): void {
  const all = loadSchedules().filter(t => t.id !== id);
  saveSchedules(all);
}

export function markRun(id: string): void {
  const all = loadSchedules();
  const task = all.find(t => t.id === id);
  if (task) {
    task.lastRunAt = new Date().toISOString();
    saveSchedules(all);
  }
}

// ── Timer Engine ──

type TaskCallback = (task: ScheduledTask) => void;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the scheduler. Checks every 30 seconds for tasks that are due.
 * Calls onTaskDue when a task should execute.
 */
export function startScheduler(onTaskDue: TaskCallback): void {
  if (timer) return;

  // Check immediately on start
  checkDueTasks(onTaskDue);

  // Then check every 30 seconds
  timer = setInterval(() => {
    checkDueTasks(onTaskDue);
  }, 30_000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function checkDueTasks(onTaskDue: TaskCallback): void {
  const tasks = loadSchedules();
  const now = Date.now();

  for (const task of tasks) {
    if (!task.enabled) continue;

    const lastRun = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
    const intervalMs = task.intervalMinutes * 60_000;

    if (now - lastRun >= intervalMs) {
      markRun(task.id);
      onTaskDue(task);
    }
  }
}
