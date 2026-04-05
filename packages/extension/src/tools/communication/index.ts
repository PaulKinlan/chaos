/**
 * Communication Tools Index
 *
 * Exports getCommunicationTools(agentId) which returns all inter-agent
 * communication tools with the agentId baked in.
 */

import type { ToolSet } from 'ai';
import { createMessageSendTool } from './message-send.js';
import { createMessageReadTool } from './message-read.js';
import { createTaskCreateTool } from './task-create.js';
import { createTaskUpdateTool } from './task-update.js';
import { createTaskListTool } from './task-list.js';
import { createArtifactPublishTool } from './artifact-publish.js';
import { createArtifactListTool } from './artifact-list.js';
import { createArtifactReadTool } from './artifact-read.js';
import { createAgentDiscoverTool } from './agent-discover.js';
import { createChannelSendTool } from './channel-send.js';

/**
 * Get all communication tools for an agent, with the agentId pre-bound.
 */
export function getCommunicationTools(agentId: string): ToolSet {
  return {
    message_send: createMessageSendTool(agentId),
    message_read: createMessageReadTool(agentId),
    task_create: createTaskCreateTool(agentId),
    task_update: createTaskUpdateTool(agentId),
    task_list: createTaskListTool(agentId),
    artifact_publish: createArtifactPublishTool(agentId),
    artifact_list: createArtifactListTool(agentId),
    artifact_read: createArtifactReadTool(agentId),
    agent_discover: createAgentDiscoverTool(agentId),
    channel_send: createChannelSendTool(agentId),
  };
}
