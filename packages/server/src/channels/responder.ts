// Response delivery handler
// When the extension sends a reply, route it to the appropriate channel

import { addResponse, type StoredMessage } from '../store.ts';

export interface ReplyPayload {
  channelType: string;
  channelId: string;
  replyTo?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export function handleReply(
  userId: string,
  payload: ReplyPayload,
): { ok: boolean; responseId: string } {
  const response: StoredMessage = {
    id: crypto.randomUUID(),
    userId,
    channelType: payload.channelType,
    channelId: payload.channelId,
    from: 'agent',
    content: payload.content,
    timestamp: new Date().toISOString(),
    metadata: {
      ...payload.metadata,
      replyTo: payload.replyTo,
    },
  };

  // For webhook channels, store the response for the external service to poll
  // For future channels (Discord, Telegram), this is where we'd call their API
  addResponse(payload.channelId, response);

  return { ok: true, responseId: response.id };
}
