/**
 * Create Agent Tool (master-only)
 *
 * Allows the master agent to spawn new sub-agents with a specific
 * role and purpose. The purpose is injected into the sub-agent's CLAUDE.md.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { createAgent, updateAgentMeta } from '../../agents/manager.js';
import { opfs } from '../../storage/opfs.js';

const AGENTS_ROOT = 'agents';

export function createCreateAgentTool(masterAgentId: string) {
  return tool({
    description:
      'Create a new sub-agent with a specific role and purpose. The purpose is written into the sub-agent\'s CLAUDE.md as additional context. Only the master agent can use this tool.',
    inputSchema: z.object({
      name: z.string().describe('Name for the new agent'),
      role: z.string().describe('Role template: neutral, researcher, coder, writer, planner, reviewer'),
      purpose: z.string().optional().describe('Purpose/context injected into the sub-agent\'s CLAUDE.md'),
      temporary: z.boolean().optional().describe('If true, agent is archived after task completion'),
    }),
    execute: async ({ name, role, purpose, temporary }) => {
      try {
        const agent = await createAgent(name, role);

        // Mark as created by master, set visibility so master can communicate
        await updateAgentMeta(agent.id, {
          createdBy: masterAgentId,
          visibility: 'visible',
          temporary: temporary ?? false,
        });

        // Inject purpose into CLAUDE.md if provided
        if (purpose) {
          const claudeMdPath = `${AGENTS_ROOT}/${agent.id}/CLAUDE.md`;
          const existing = await opfs.readFile(claudeMdPath);
          const purposeSection = `\n\n## Purpose (from Master Agent)\n\n${purpose}\n`;
          await opfs.writeFile(claudeMdPath, existing + purposeSection);
        }

        return {
          ok: true,
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
