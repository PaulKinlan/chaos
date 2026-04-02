/**
 * Artifact List Tool
 *
 * List shared artifacts, optionally filtered by producing agent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listArtifacts } from '../../storage/shared.js';

export function createArtifactListTool(_agentId: string) {
  return tool({
    description:
      'List shared artifacts published by agents. Optionally filter by producing agent ID.',
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe('Filter artifacts by the agent that published them'),
    }),
    execute: async ({ agentId }) => {
      return listArtifacts({ agentId });
    },
  });
}
