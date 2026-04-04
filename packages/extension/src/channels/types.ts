// Channel types for the extension
// Mirrors the shared types from packages/shared/src/types.ts

export interface ChannelMessage {
  id: string;
  channelType: 'discord' | 'telegram' | 'email' | 'webhook' | 'slack';
  channelId: string;
  from: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelResponse {
  channelType: string;
  channelId: string;
  replyTo?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export type ChannelDirection = 'inbound' | 'bidirectional';

export interface ChannelConfig {
  id: string;
  type: 'discord' | 'telegram' | 'email' | 'webhook' | 'slack';
  direction: ChannelDirection;
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface RelayPollResponse {
  messages: ChannelMessage[];
  since: string;
}
