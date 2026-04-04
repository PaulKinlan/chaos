// Channel message format (extension <-> server protocol)
export interface ChannelMessage {
  id: string;
  channelType: 'discord' | 'telegram' | 'email' | 'webhook' | 'slack';
  channelId: string;
  from: string;       // sender identifier (username, email, etc.)
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;  // channel-specific data
}

export interface ChannelResponse {
  channelType: string;
  channelId: string;
  replyTo?: string;    // message ID to reply to
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelConfig {
  id: string;
  type: 'discord' | 'telegram' | 'email' | 'webhook' | 'slack';
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;  // bot tokens, webhook URLs, etc.
}

// Relay protocol
export interface RelayPollResponse {
  messages: ChannelMessage[];
  since: string;  // timestamp for next poll
}

// Skill manifest (shared format)
export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
  source?: string;
}
