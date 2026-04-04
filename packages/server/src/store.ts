// In-memory message store for the relay server
// Phase 2: adds message expiry (24 hours) and periodic cleanup

import { logger } from './logger.ts';
import { pushToUser } from './ws.ts';

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
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;  // 10 minutes

// userId -> messages (most recent last)
const messageStore: Map<string, StoredMessage[]> = new Map();

// channelId -> responses waiting to be picked up
const responseStore: Map<string, StoredMessage[]> = new Map();

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
 * Remove messages older than 24 hours from all stores.
 */
export function cleanupExpiredMessages(): number {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  let removed = 0;

  for (const [userId, msgs] of messageStore) {
    const before = msgs.length;
    const filtered = msgs.filter((m) => new Date(m.timestamp).getTime() > cutoff);
    if (filtered.length < before) {
      removed += before - filtered.length;
      if (filtered.length === 0) {
        messageStore.delete(userId);
      } else {
        messageStore.set(userId, filtered);
      }
    }
  }

  for (const [channelId, msgs] of responseStore) {
    const before = msgs.length;
    const filtered = msgs.filter((m) => new Date(m.timestamp).getTime() > cutoff);
    if (filtered.length < before) {
      removed += before - filtered.length;
      if (filtered.length === 0) {
        responseStore.delete(channelId);
      } else {
        responseStore.set(channelId, filtered);
      }
    }
  }

  if (removed > 0) {
    logger.debug('store', 'Cleaned up expired messages', { removed });
  }

  return removed;
}

export function addMessage(userId: string, msg: StoredMessage): void {
  let msgs = messageStore.get(userId);
  if (!msgs) {
    msgs = [];
    messageStore.set(userId, msgs);
  }
  msgs.push(msg);
  logger.debug('store', 'Message stored', { userId, messageId: msg.id, channelType: msg.channelType, channelId: msg.channelId });
  // Keep only the last MAX_MESSAGES_PER_USER
  if (msgs.length > MAX_MESSAGES_PER_USER) {
    messageStore.set(userId, msgs.slice(-MAX_MESSAGES_PER_USER));
  }

  // Push to any connected WebSocket clients immediately
  pushToUser(userId, { type: 'message', message: msg });
}

export function getMessages(userId: string, since?: string): StoredMessage[] {
  const msgs = messageStore.get(userId) || [];
  if (!since) return [...msgs];
  const sinceTime = new Date(since).getTime();
  return msgs.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
}

export function clearMessages(userId: string): void {
  messageStore.delete(userId);
}

export function addResponse(channelId: string, msg: StoredMessage): void {
  let msgs = responseStore.get(channelId);
  if (!msgs) {
    msgs = [];
    responseStore.set(channelId, msgs);
  }
  msgs.push(msg);
  logger.debug('store', 'Response stored', { channelId, messageId: msg.id });
}

export function getResponses(channelId: string, since?: string): StoredMessage[] {
  const msgs = responseStore.get(channelId) || [];
  if (!since) return [...msgs];
  const sinceTime = new Date(since).getTime();
  return msgs.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
}

export function clearResponses(channelId: string): void {
  responseStore.delete(channelId);
}

/** Get all recent messages across all users (for admin debugging). */
export function getAllRecentMessages(limit = 50): StoredMessage[] {
  const all: StoredMessage[] = [];
  for (const msgs of messageStore.values()) {
    all.push(...msgs);
  }
  for (const msgs of responseStore.values()) {
    all.push(...msgs);
  }
  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return all.slice(0, limit);
}
