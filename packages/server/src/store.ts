// Message store for the relay server
// Primary storage: Deno KV (survives isolate restarts)
// In-memory Maps kept as a fast cache only

import { logger } from "./logger.ts";
import { getConnectionCount, pushToUser } from "./ws.ts";
import { getKv, instrumentKv, isKvAvailable } from "./kv.ts";

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

// Deno KV caps a single value at 65536 bytes (the v8-serialized form). A large
// inbound body — a long email thread, stripped HTML — would otherwise throw
// "Value too large" and drop the message entirely. Cap the content so the whole
// record fits, leaving headroom for metadata + serialization overhead.
const KV_MAX_VALUE_BYTES = 65536;
const KV_VALUE_SAFETY_MARGIN = 2048;

/**
 * Truncate `msg.content` (by bytes) so the serialized record stays under the KV
 * value limit. Returns the original message untouched when it already fits.
 */
export function fitMessageForKv(msg: StoredMessage): StoredMessage {
  const enc = new TextEncoder();
  const contentBytes = enc.encode(msg.content);
  // Budget = limit − (everything except content) − margin.
  const overhead = enc.encode(JSON.stringify({ ...msg, content: "" })).length;
  const budget = KV_MAX_VALUE_BYTES - overhead - KV_VALUE_SAFETY_MARGIN;
  if (contentBytes.length <= budget) return msg;

  const marker = "\n\n[Message truncated: too large to deliver in full.]";
  const keep = Math.max(0, budget - enc.encode(marker).length);
  // Decode the byte slice; a split trailing multibyte char becomes U+FFFD.
  const truncated = new TextDecoder().decode(contentBytes.slice(0, keep)) +
    marker;
  logger.warn("store", "Message content truncated to fit KV value limit", {
    userId: msg.userId,
    channelType: msg.channelType,
    originalBytes: contentBytes.length,
    keptBytes: keep,
  });
  return {
    ...msg,
    content: truncated,
    metadata: {
      ...msg.metadata,
      truncated: true,
      originalContentBytes: contentBytes.length,
    },
  };
}

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
  // Cap oversized content so it can't exceed the KV 64KB value limit (and so the
  // in-memory cache stays consistent with what was persisted).
  msg = fitMessageForKv(msg);

  // Store in KV (primary, durable)
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    await instrumentKv(
      "addMessage.set",
      () =>
        kv.set(["messages", userId, msg.timestamp, msg.id], msg, {
          expireIn: MESSAGE_TTL_MS,
        }),
    );
    // Update the watch key so kv.watch() on other isolates sees the new message
    await instrumentKv(
      "addMessage.lastMessage",
      () =>
        kv.set(["last_message", userId], {
          messageId: msg.id,
          timestamp: msg.timestamp,
        }),
    );
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

  const wsCount = getConnectionCount(userId);
  logger.info("store", "Message stored", {
    userId,
    messageId: msg.id,
    channelType: msg.channelType,
    channelId: msg.channelId,
    from: msg.from,
    kvStored: isKvAvailable(),
    wsConnections: wsCount,
    delivery: wsCount > 0 ? "ws-push" : "poll-pending",
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
    const msgs: StoredMessage[] = [];
    // Always scan all messages for this user, filter by timestamp in code
    // KV keys: ["messages", userId, timestamp, id] — sorted lexicographically
    const selector = since
      ? {
        start: ["messages", userId, since],
        end: ["messages", userId, "\xff"],
      }
      : { prefix: ["messages", userId] as Deno.KvKey };
    const iter = kv.list<StoredMessage>(selector, {
      limit: MAX_MESSAGES_PER_USER,
    });
    for await (const entry of iter) {
      const m = entry.value;
      // Skip the exact `since` timestamp (we want strictly after)
      if (
        since && new Date(m.timestamp).getTime() <= new Date(since).getTime()
      ) {
        continue;
      }
      msgs.push(m);
    }
    logger.debug("store", "Messages retrieved from KV", {
      userId,
      since: since || "(all)",
      count: msgs.length,
    });
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

// ── Reply target ──
// The chat/thread an inbound message came from (e.g. a Telegram chatId). The
// agent never sees this routing detail, so we record it per channel on every
// inbound message and fall back to it when sending a reply. Persisted in KV so
// it survives isolate restarts (in-memory token caches do not).
const replyTargetCache: Map<string, string> = new Map();

export async function setReplyTarget(
  channelId: string,
  target: string,
): Promise<void> {
  if (replyTargetCache.get(channelId) === target) return; // unchanged — skip write
  replyTargetCache.set(channelId, target);
  if (isKvAvailable() && getKv()) {
    await getKv()!.set(["reply_target", channelId], target);
  }
  logger.info("store", "Reply target recorded", { channelId, target });
}

export async function getReplyTarget(
  channelId: string,
): Promise<string | undefined> {
  const cached = replyTargetCache.get(channelId);
  if (cached) return cached;
  if (isKvAvailable() && getKv()) {
    const entry = await getKv()!.get<string>(["reply_target", channelId]);
    if (entry.value) {
      replyTargetCache.set(channelId, entry.value);
      return entry.value;
    }
  }
  return undefined;
}

export async function getResponses(
  channelId: string,
  since?: string,
): Promise<StoredMessage[]> {
  // Read from KV
  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    const msgs: StoredMessage[] = [];
    const selector = since
      ? {
        start: ["responses", channelId, since],
        end: ["responses", channelId, "\xff"],
      }
      : { prefix: ["responses", channelId] as Deno.KvKey };
    const iter = kv.list<StoredMessage>(selector, { limit: 100 });
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

/** Get all messages (inbound + outbound) for a specific user from KV. */
export async function getMessagesForUser(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<{ messages: StoredMessage[]; cursor?: string }> {
  const all: StoredMessage[] = [];

  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    // Inbound messages keyed by ["messages", userId, timestamp, id]
    const msgIter = kv.list<StoredMessage>(
      { prefix: ["messages", userId] },
      { limit: limit * 2, reverse: true },
    );
    for await (const entry of msgIter) {
      all.push(entry.value);
    }

    // Outbound responses keyed by ["responses", channelId, timestamp, id]
    // We need to scan all responses and filter by userId
    const respIter = kv.list<StoredMessage>(
      { prefix: ["responses"] },
      { limit: limit * 4, reverse: true },
    );
    for await (const entry of respIter) {
      if (entry.value.userId === userId) {
        all.push(entry.value);
      }
    }
  } else {
    const msgs = messageCache.get(userId) || [];
    all.push(...msgs);
    for (const resps of responseCache.values()) {
      all.push(...resps.filter((r) => r.userId === userId));
    }
  }

  all.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Simple offset-based pagination using cursor (ISO timestamp of last item)
  let filtered = all;
  if (cursor) {
    const cursorTime = new Date(cursor).getTime();
    filtered = all.filter((m) => new Date(m.timestamp).getTime() < cursorTime);
  }

  const page = filtered.slice(0, limit);
  const nextCursor = page.length === limit
    ? page[page.length - 1].timestamp
    : undefined;

  return { messages: page, cursor: nextCursor };
}

/**
 * Warm the message caches from KV. Call once after KV init.
 */
export async function warmMessageCache(): Promise<void> {
  if (!isKvAvailable() || !getKv()) return;
  const kv = getKv()!;
  const t = performance.now();
  let msgCount = 0;
  let respCount = 0;

  // Load recent messages
  const msgIter = kv.list<StoredMessage>({ prefix: ["messages"] }, {
    limit: 200,
    reverse: true,
  });
  for await (const entry of msgIter) {
    const m = entry.value;
    let msgs = messageCache.get(m.userId);
    if (!msgs) {
      msgs = [];
      messageCache.set(m.userId, msgs);
    }
    // Avoid duplicates
    if (!msgs.some((x) => x.id === m.id)) {
      msgs.push(m);
      msgCount++;
    }
  }

  // Load recent responses
  const respIter = kv.list<StoredMessage>({ prefix: ["responses"] }, {
    limit: 200,
    reverse: true,
  });
  for await (const entry of respIter) {
    const m = entry.value;
    let resps = responseCache.get(m.channelId);
    if (!resps) {
      resps = [];
      responseCache.set(m.channelId, resps);
    }
    if (!resps.some((x) => x.id === m.id)) {
      resps.push(m);
      respCount++;
    }
  }

  logger.info("store", "Message cache warmed from KV", {
    messages: msgCount,
    responses: respCount,
    ms: Math.round(performance.now() - t),
  });
}

/** Get recent messages from in-memory cache only (instant, no KV). */
export function getCachedRecentMessages(limit = 30): StoredMessage[] {
  const all: StoredMessage[] = [];
  for (const msgs of messageCache.values()) all.push(...msgs);
  for (const msgs of responseCache.values()) all.push(...msgs);
  all.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return all.slice(0, limit);
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
