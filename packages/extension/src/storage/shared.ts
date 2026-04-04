/**
 * Shared space convenience layer over OPFS.
 *
 * Provides the inter-agent message bus, task board (event-sourced), and
 * artifact registry. All backed by append-only JSONL files in /shared/.
 */

import { opfs } from './opfs.js';
import type { AgentMessage, TaskEvent, Task, ArtifactMeta } from './types.js';

// ── Paths ──

const MESSAGES_PATH = 'shared/messages.jsonl';
const TASKS_PATH = 'shared/tasks.jsonl';
const ARTIFACTS_PATH = 'shared/artifacts.jsonl';

// ── Messages ──

/**
 * Append a message to the shared message log.
 */
export async function appendMessage(msg: AgentMessage): Promise<void> {
  const line = JSON.stringify(msg) + '\n';
  await opfs.appendFile(MESSAGES_PATH, line);
}

export interface GetMessagesOpts {
  agentId?: string;   // filter by sender
  since?: string;     // ISO 8601 timestamp — messages on or after
  limit?: number;     // max messages to return (from the tail)
}

/**
 * Read messages from the shared log, optionally filtered.
 */
export async function getMessages(opts?: GetMessagesOpts): Promise<AgentMessage[]> {
  let lines: string[];
  try {
    lines = await opfs.readLines(MESSAGES_PATH);
  } catch {
    return []; // file doesn't exist yet
  }

  let messages: AgentMessage[] = lines.map((line) => JSON.parse(line) as AgentMessage);

  if (opts?.agentId) {
    messages = messages.filter((m) => m.from === opts.agentId);
  }

  if (opts?.since) {
    const sinceTime = new Date(opts.since).getTime();
    messages = messages.filter((m) => new Date(m.timestamp).getTime() >= sinceTime);
  }

  if (opts?.limit !== undefined && opts.limit > 0) {
    messages = messages.slice(-opts.limit);
  }

  return messages;
}

// ── Task board (event-sourced) ──

/**
 * Append a task event to the shared task log.
 */
export async function appendTaskEvent(event: TaskEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  await opfs.appendFile(TASKS_PATH, line);
}

/**
 * Compute the current state of all tasks by replaying the event log.
 *
 * Events are applied in order. A 'created' event initialises a task.
 * Subsequent 'updated' events merge their `data` into the existing state.
 */
export async function getTaskState(): Promise<Task[]> {
  let lines: string[];
  try {
    lines = await opfs.readLines(TASKS_PATH);
  } catch {
    return [];
  }

  const tasks = new Map<string, Task>();

  for (const line of lines) {
    const event = JSON.parse(line) as TaskEvent;

    if (event.type === 'created') {
      tasks.set(event.taskId, {
        id: event.taskId,
        subject: event.data.subject ?? '',
        description: event.data.description,
        owner: event.data.owner,
        status: event.data.status ?? 'pending',
        blockedBy: event.data.blockedBy,
        result: event.data.result,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      });
    } else if (event.type === 'updated') {
      const existing = tasks.get(event.taskId);
      if (existing) {
        tasks.set(event.taskId, {
          ...existing,
          ...stripUndefined(event.data),
          updatedAt: event.timestamp,
        });
      }
      // If there's no existing task for an 'updated' event, we silently
      // ignore it. The log may have been truncated or corrupted.
    }
  }

  return Array.from(tasks.values());
}

/**
 * Get tasks that are not blocked (all blockedBy tasks are completed).
 */
export async function getUnblockedTasks(): Promise<Task[]> {
  const tasks = await getTaskState();
  const completedIds = new Set(
    tasks.filter((t) => t.status === 'completed').map((t) => t.id),
  );

  return tasks.filter((task) => {
    if (task.status === 'completed' || task.status === 'failed') {
      return false;
    }
    if (!task.blockedBy || task.blockedBy.length === 0) {
      return true;
    }
    return task.blockedBy.every((depId) => completedIds.has(depId));
  });
}

/**
 * When a task completes, find tasks that were blocked by it and are now
 * fully unblocked (all their blockedBy tasks are completed).
 * Returns the newly unblocked tasks.
 */
export async function getNewlyUnblockedTasks(completedTaskId: string): Promise<Task[]> {
  const tasks = await getTaskState();
  const completedIds = new Set(
    tasks.filter((t) => t.status === 'completed').map((t) => t.id),
  );

  return tasks.filter((task) => {
    // Only consider pending or in_progress tasks
    if (task.status === 'completed' || task.status === 'failed') return false;
    // Must have a blockedBy list that includes the just-completed task
    if (!task.blockedBy || !task.blockedBy.includes(completedTaskId)) return false;
    // All blockers must now be completed
    return task.blockedBy.every((depId) => completedIds.has(depId));
  });
}

// ── Artifacts ──

/**
 * Publish an artifact to the shared space. The actual file should already
 * exist at the given path in OPFS.
 */
export async function publishArtifact(
  agentId: string,
  path: string,
  description: string,
): Promise<void> {
  const meta: ArtifactMeta = {
    agentId,
    path,
    description,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(meta) + '\n';
  await opfs.appendFile(ARTIFACTS_PATH, line);
}

export interface ListArtifactsOpts {
  agentId?: string;
}

/**
 * List all published artifacts, optionally filtered by producing agent.
 */
export async function listArtifacts(opts?: ListArtifactsOpts): Promise<ArtifactMeta[]> {
  let lines: string[];
  try {
    lines = await opfs.readLines(ARTIFACTS_PATH);
  } catch {
    return [];
  }

  let artifacts: ArtifactMeta[] = lines.map((l) => JSON.parse(l) as ArtifactMeta);

  if (opts?.agentId) {
    artifacts = artifacts.filter((a) => a.agentId === opts.agentId);
  }

  return artifacts;
}

// ── Helpers ──

/** Remove keys whose values are undefined so they don't overwrite existing data. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
