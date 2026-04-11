/**
 * Master Tools Index
 *
 * Exports getMasterTools(agentId, isMaster) which returns master-only tools
 * when the agent has master: true, and find_agent for all agents.
 */

import type { ToolSet } from 'ai';
import { createCreateAgentTool } from './create-agent.js';
import { createDeleteAgentTool } from './delete-agent.js';
import { createAssignTaskTool } from './assign-task.js';
import { createGetAgentStatusTool } from './get-agent-status.js';
import { createFindAgentTool } from './find-agent.js';
import { createBroadcastMessageTool } from './broadcast-message.js';
import { createSetAgentHookTool } from './set-agent-hook.js';
import { createSetAgentScheduleTool } from './set-agent-schedule.js';

/**
 * Get master tools for an agent.
 *
 * - If isMaster is true: returns all master tools (create, delete, assign, status, find, broadcast, set-hook, set-schedule)
 * - If isMaster is false: returns only find_agent (available to all agents)
 */
export function getMasterTools(agentId: string, isMaster: boolean): ToolSet {
  // find_agent is available to all agents
  const tools: ToolSet = {
    find_agent: createFindAgentTool(agentId),
  };

  // Master-only tools
  if (isMaster) {
    tools.create_agent = createCreateAgentTool(agentId);
    tools.delete_agent = createDeleteAgentTool(agentId);
    tools.assign_task = createAssignTaskTool(agentId);
    tools.get_agent_status = createGetAgentStatusTool(agentId);
    tools.broadcast_message = createBroadcastMessageTool(agentId);
    tools.set_agent_hook = createSetAgentHookTool(agentId);
    tools.set_agent_schedule = createSetAgentScheduleTool(agentId);
  }

  return tools;
}
