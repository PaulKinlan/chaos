// In-memory message store for the relay server
// Phase 1: no database, just a Map. Good enough for testing.

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

// userId -> messages (most recent last)
const messageStore: Map<string, StoredMessage[]> = new Map();

// channelId -> responses waiting to be picked up
const responseStore: Map<string, StoredMessage[]> = new Map();

export function addMessage(userId: string, msg: StoredMessage): void {
  let msgs = messageStore.get(userId);
  if (!msgs) {
    msgs = [];
    messageStore.set(userId, msgs);
  }
  msgs.push(msg);
  // Keep only the last MAX_MESSAGES_PER_USER
  if (msgs.length > MAX_MESSAGES_PER_USER) {
    messageStore.set(userId, msgs.slice(-MAX_MESSAGES_PER_USER));
  }
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
