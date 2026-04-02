/**
 * Artifact Read Tool
 *
 * Read the content of a shared artifact by path.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../../storage/opfs.js';

export function createArtifactReadTool(_agentId: string) {
  return tool({
    description:
      'Read the content of a shared artifact by its path (as returned by artifact_list).',
    parameters: z.object({
      path: z
        .string()
        .describe('Full artifact path (e.g. shared/artifacts/agent-id/file.md)'),
    }),
    execute: async ({ path }) => {
      try {
        const content = await opfs.readFile(path);
        return { ok: true, path, content };
      } catch {
        return { ok: false, error: `Artifact not found: ${path}` };
      }
    },
  });
}
