// Channel message format (extension <-> server protocol)
export interface InboundAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
}

export interface ChannelMessage {
  id: string;
  channelType: "discord" | "telegram" | "email" | "webhook" | "slack";
  channelId: string;
  from: string; // sender identifier (username, email, etc.)
  content: string;
  timestamp: string;
  attachments?: InboundAttachment[]; // descriptors only; bytes use the signed retrieval endpoint
  metadata?: Record<string, unknown>; // channel-specific data
}

export interface ReplyAttachment {
  filename: string;
  mimeType: string;
  dataBase64: string; // base64-encoded file bytes
}

export interface ChannelResponse {
  channelType: string;
  channelId: string;
  replyTo?: string; // message ID to reply to
  content: string;
  attachments?: ReplyAttachment[]; // forwarded to the channel (Telegram photo/document, email attachment)
  metadata?: Record<string, unknown>;
}

export type ChannelDirection = "inbound" | "bidirectional";

export interface ChannelConfig {
  id: string;
  name?: string; // human-readable label (e.g. "GitHub Webhooks", "Deploy Bot")
  type: "discord" | "telegram" | "email" | "webhook" | "slack";
  direction: ChannelDirection; // inbound = receive only, bidirectional = receive + reply
  prompt?: string; // instructions for the agent when processing messages from this channel
  agentId: string;
  enabled: boolean;
  runInBackground?: boolean; // true = no UI column, runs silently (default: false)
  notifyOnComplete?: boolean; // show desktop notification when done (default: true for background)
  metadata: Record<string, unknown>; // bot tokens, webhook URLs, etc.
}

// Relay protocol
export interface RelayPollResponse {
  messages: ChannelMessage[];
  since: string; // timestamp for next poll
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
