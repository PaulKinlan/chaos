// Message store for the relay server
// Primary storage: Deno KV (survives isolate restarts)
// In-memory Maps kept as a fast cache only

import { logger } from "./logger.ts";
import { pushToUser } from "./ws.ts";
import { getKv, isKvAvailable } from "./kv.ts";

export interface StoredMessage {
  id: string;
  userId: string;
  channelType: string;
  channelId: string;
  from: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGES_PER_USER = 100;
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory caches (hot path only, KV is the source of truth)
const messageCache: Map<string, StoredMessage[]> = new Map();
const responseCache: Map<string, StoredMessage[]> = new Map();

// Periodic cleanup timer
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic message cleanup timer.
 * Call once at server startup.
 */
export function startMessageCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupExpiredMessages();
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup timer (for graceful shutdown).
 */
export function stopMessageCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Clean up expired messages from in-memory caches.
 * KV entries expire automatically via expireIn.
 */
export function cleanupExpiredMessages(): number {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  let removed = 0;

  for (const [userId, msgs] of messageCache) {
    const before = msgs.length;
    const filtered = msgs.filter((m) =>
      new Date(m.timestamp).getTime() > cutoff
    );
    if (filtered.length < before) {
      removed += before - filtered.length;
      if (filtered.length === 0) {
        messageCache.delete(userId);
      } else {
        messageCache.set(userId, filtered);
      }
    }
  }

  for (const [channelId, msgs] of responseCache) {
    const before = msgs.length;
    const filtered = msgs.filter((m) =>
      new Date(m.timestamp).getTime() > cutoff
    );
    if (filtered.length < before) {
      removed += before - filtered.length;
      if (filtered.length === 0) {
        responseCache.delete(channelId);
      } else {
        responseCache.set(channelId, filtered);
      }
    }
  }

  if (removed > 0) {
    logger.debug("store", "Cleaned up expired cache entries", { removed });
  }

  return removed;
}

export async function addMessage(
  userId: string,
  msg: StoredMessage,
): Promise<void> {
  // Store in KV (primary, durable)
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    await kv.set(["messages", userId, msg.timestamp, msg.id], msg, {
      expireIn: MESSAGE_TTL_MS,
    });
  }

  // Cache in memory
  let msgs = messageCache.get(userId);
  if (!msgs) {
    msgs = [];
    messageCache.set(userId, msgs);
  }
  msgs.push(msg);
  if (msgs.length > MAX_MESSAGES_PER_USER) {
    messageCache.set(userId, msgs.slice(-MAX_MESSAGES_PER_USER));
  }

  logger.info("store", "Message stored", {
    userId,
    messageId: msg.id,
    channelType: msg.channelType,
    channelId: msg.channelId,
    from: msg.from,
  });

  // Push to any connected WebSocket clients immediately
  pushToUser(userId, { type: "message", message: msg });
}

export async function getMessages(
  userId: string,
  since?: string,
): Promise<StoredMessage[]> {
  // Read from KV (source of truth)
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    const prefix = since ? ["messages", userId, since] : ["messages", userId];
    const msgs: StoredMessage[] = [];
    const iter = kv.list<StoredMessage>({ prefix }, {
      limit: MAX_MESSAGES_PER_USER,
    });
    for await (const entry of iter) {
      const m = entry.value;
      if (
        since && new Date(m.timestamp).getTime() <= new Date(since).getTime()
      ) {
        continue;
      }
      msgs.push(m);
    }
    return msgs;
  }

  // Fallback to in-memory cache
  const msgs = messageCache.get(userId) || [];
  if (!since) return [...msgs];
  const sinceTime = new Date(since).getTime();
  return msgs.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
}

export async function clearMessages(userId: string): Promise<void> {
  messageCache.delete(userId);
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    const iter = kv.list({ prefix: ["messages", userId] });
    for await (const entry of iter) {
      await kv.delete(entry.key);
    }
  }
}

export async function addResponse(
  channelId: string,
  msg: StoredMessage,
): Promise<void> {
  // Store in KV
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    await kv.set(["responses", channelId, msg.timestamp, msg.id], msg, {
      expireIn: MESSAGE_TTL_MS,
    });
  }

  // Cache in memory
  let msgs = responseCache.get(channelId);
  if (!msgs) {
    msgs = [];
    responseCache.set(channelId, msgs);
  }
  msgs.push(msg);

  logger.info("store", "Response stored", {
    channelId,
    messageId: msg.id,
    from: msg.from,
  });
}

export async function getResponses(
  channelId: string,
  since?: string,
): Promise<StoredMessage[]> {
  // Read from KV
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    const prefix = since
      ? ["responses", channelId, since]
      : ["responses", channelId];
    const msgs: StoredMessage[] = [];
    const iter = kv.list<StoredMessage>({ prefix }, { limit: 100 });
    for await (const entry of iter) {
      const m = entry.value;
      if (
        since && new Date(m.timestamp).getTime() <= new Date(since).getTime()
      ) {
        continue;
      }
      msgs.push(m);
    }
    return msgs;
  }

  // Fallback
  const msgs = responseCache.get(channelId) || [];
  if (!since) return [...msgs];
  const sinceTime = new Date(since).getTime();
  return msgs.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
}

export async function clearResponses(channelId: string): Promise<void> {
  responseCache.delete(channelId);
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    const iter = kv.list({ prefix: ["responses", channelId] });
    for await (const entry of iter) {
      await kv.delete(entry.key);
    }
  }
}

/** Get all recent messages from KV (durable across isolate restarts). */
export async function getAllRecentMessages(
  limit = 50,
): Promise<StoredMessage[]> {
  const all: StoredMessage[] = [];

  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    // Scan messages and responses from KV
    for (const prefix of [["messages"], ["responses"]] as Deno.KvKey[]) {
      const iter = kv.list<StoredMessage>({ prefix }, {
        limit,
        reverse: true,
      });
      for await (const entry of iter) {
        all.push(entry.value);
      }
    }
  } else {
    // Fallback to in-memory caches
    for (const msgs of messageCache.values()) all.push(...msgs);
    for (const msgs of responseCache.values()) all.push(...msgs);
  }

  all.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return all.slice(0, limit);
}
