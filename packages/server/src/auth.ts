// Simple API key authentication
// Phase 1: in-memory session store, no OAuth

import type { ChannelConfig } from '@chaos/shared';

export interface UserSession {
  userId: string;
  apiKey: string;
  createdAt: string;
  channels: ChannelConfig[];
}

// apiKey -> session
const sessions: Map<string, UserSession> = new Map();

// userId -> apiKey (reverse lookup)
const userIndex: Map<string, string> = new Map();

export function validateAuth(req: Request): UserSession | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const apiKey = match[1];
  return sessions.get(apiKey) || null;
}

export function createSession(): { userId: string; apiKey: string } {
  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const session: UserSession = {
    userId,
    apiKey,
    createdAt: new Date().toISOString(),
    channels: [],
  };

  sessions.set(apiKey, session);
  userIndex.set(userId, apiKey);

  return { userId, apiKey };
}

export function getSessionByUserId(userId: string): UserSession | null {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return null;
  return sessions.get(apiKey) || null;
}

export function getSessionByChannelId(channelId: string): UserSession | null {
  for (const session of sessions.values()) {
    if (session.channels.some((ch) => ch.id === channelId)) {
      return session;
    }
  }
  return null;
}

export function addChannel(userId: string, channel: ChannelConfig): void {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return;
  const session = sessions.get(apiKey);
  if (!session) return;
  session.channels.push(channel);
}

export function removeChannel(userId: string, channelId: string): boolean {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return false;
  const session = sessions.get(apiKey);
  if (!session) return false;
  const idx = session.channels.findIndex((ch) => ch.id === channelId);
  if (idx === -1) return false;
  session.channels.splice(idx, 1);
  return true;
}

export function getChannels(userId: string): ChannelConfig[] {
  const apiKey = userIndex.get(userId);
  if (!apiKey) return [];
  const session = sessions.get(apiKey);
  if (!session) return [];
  return session.channels;
}
