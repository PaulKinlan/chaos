/**
 * permissions-demo.ts — Permission modes.
 *
 * Three agents demonstrating permission modes: accept-all, deny-all, and ask
 * (with a mock callback). Also shows per-tool overrides that can punch through
 * the base mode.
 *
 * Run: npx tsx examples/permissions-demo.ts
 */

import { createAgent, type PermissionConfig } from '@chaos/agent-loop';
import { createMockModel } from '@chaos/agent-loop/testing';
import { tool } from 'ai';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

const readFile = tool({
  description: 'Read a file from disk.',
  inputSchema: s(z.object({ path: z.string() })),
  execute: async ({ path }: { path: string }) => `Contents of ${path}: [mock data]`,
});

const deleteFile = tool({
  description: 'Delete a file from disk.',
  inputSchema: s(z.object({ path: z.string() })),
  execute: async ({ path }: { path: string }) => `Deleted ${path}`,
});

function makeModel() {
  return createMockModel({
    responses: [
      { toolCalls: [{ toolName: 'readFile', args: { path: '/tmp/test.txt' } }] },
      { text: 'Done reading the file.' },
    ],
  });
}

const configs: Array<{ label: string; permissions: PermissionConfig }> = [
  { label: 'accept-all', permissions: { mode: 'accept-all' } },
  { label: 'deny-all', permissions: { mode: 'deny-all' } },
  {
    label: 'ask (with callback + per-tool overrides)',
    permissions: {
      mode: 'ask',
      tools: { readFile: 'always', deleteFile: 'never' },
      onPermissionRequest: async (req) => {
        console.log(`    [permission] asked for "${req.toolName}" -> approving`);
        return true;
      },
    },
  },
];

for (const { label, permissions } of configs) {
  console.log(`\n--- Mode: ${label} ---`);
  const agent = createAgent({
    id: `perm-${label}`,
    name: `Permission Agent (${label})`,
    model: makeModel(),
    tools: { readFile, deleteFile },
    permissions,
  });
  const result = await agent.run('Read the test file');
  console.log('Result:', result);
}
