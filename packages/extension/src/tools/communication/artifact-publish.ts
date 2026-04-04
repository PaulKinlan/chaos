/**
 * Artifact Publish Tool
 *
 * Publish a file from the agent's OPFS as a shared artifact.
 * Copies the content to the shared artifacts space and registers metadata.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../../storage/opfs.js';
import { publishArtifact } from '../../storage/shared.js';

const AGENTS_ROOT = 'agents';
const SHARED_ARTIFACTS = 'shared/artifacts';

export function createArtifactPublishTool(agentId: string) {
  return tool({
    description:
      "Publish a file from your private storage as a shared artifact that other agents can discover and read. The file's content is copied to the shared artifacts space.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("File path relative to your agent root directory (e.g. 'research/report.md')"),
      description: z
        .string()
        .describe('Brief description of this artifact for other agents'),
    }),
    execute: async ({ path, description }) => {
      // Read the file from the agent's private storage
      const sourcePath = `${AGENTS_ROOT}/${agentId}/${path}`;
      let content: string;
      try {
        content = await opfs.readFile(sourcePath);
      } catch {
        return { ok: false, error: `File not found: ${path}` };
      }

      // Copy to shared artifacts space
      const artifactPath = `${SHARED_ARTIFACTS}/${agentId}/${path}`;
      await opfs.writeFile(artifactPath, content);

      // Register metadata
      await publishArtifact(agentId, artifactPath, description);

      return {
        ok: true,
        artifactPath,
        description,
        timestamp: new Date().toISOString(),
      };
    },
  });
}
