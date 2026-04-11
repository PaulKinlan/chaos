/**
 * Tests for MCP tool bridge — converting MCP tools to Vercel AI SDK tools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpToolsToAiTools } from '../tool-bridge.js';
import { McpClient, type McpTool, type McpServerConfig } from '../client.js';

// ── Helpers ──

function createMockClient(): McpClient {
  const config: McpServerConfig = {
    url: 'https://mcp.example.com/v1',
    name: 'test-server',
  };
  const client = new McpClient(config);
  return client;
}

const sampleTools: McpTool[] = [
  {
    name: 'search',
    description: 'Search the web for information',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_file',
    description: 'Read a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
    },
  },
  {
    name: 'simple_tool',
    description: 'A tool with no input schema',
    inputSchema: {},
  },
];

// ── Tests ──

describe('mcpToolsToAiTools', () => {
  let client: McpClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it('converts MCP tools to AI SDK tools with correct prefixed names', () => {
    const tools = mcpToolsToAiTools(client, sampleTools, 'mcp_test_');

    expect(Object.keys(tools)).toEqual([
      'mcp_test_search',
      'mcp_test_get_file',
      'mcp_test_simple_tool',
    ]);
  });

  it('preserves tool descriptions', () => {
    const tools = mcpToolsToAiTools(client, sampleTools, 'mcp_test_');

    // The AI SDK tool wraps the description
    const searchTool = tools['mcp_test_search'];
    expect(searchTool).toBeDefined();
    // Description is stored in the tool object
    expect((searchTool as unknown as { description: string }).description).toBe('Search the web for information');
  });

  it('returns empty object for empty tools array', () => {
    const tools = mcpToolsToAiTools(client, [], 'mcp_test_');
    expect(tools).toEqual({});
  });

  it('handles tools with empty input schema', () => {
    const tools = mcpToolsToAiTools(client, [sampleTools[2]], 'mcp_test_');
    expect(tools['mcp_test_simple_tool']).toBeDefined();
  });

  it('creates tools with execute functions', () => {
    const tools = mcpToolsToAiTools(client, sampleTools, 'mcp_test_');

    for (const toolName of Object.keys(tools)) {
      const t = tools[toolName] as unknown as { execute: (...args: unknown[]) => unknown };
      expect(typeof t.execute).toBe('function');
    }
  });

  it('uses different prefixes to namespace tools', () => {
    const githubTools = mcpToolsToAiTools(client, [sampleTools[0]], 'mcp_github_');
    const jiraTools = mcpToolsToAiTools(client, [sampleTools[0]], 'mcp_jira_');

    expect(Object.keys(githubTools)).toEqual(['mcp_github_search']);
    expect(Object.keys(jiraTools)).toEqual(['mcp_jira_search']);
  });

  it('calls client.callTool with the original tool name on execute', async () => {
    // Mock callTool on the client
    const callToolSpy = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
    (client as unknown as { callTool: typeof callToolSpy }).callTool = callToolSpy;

    const tools = mcpToolsToAiTools(client, [sampleTools[0]], 'mcp_test_');
    const searchTool = tools['mcp_test_search'] as unknown as { execute: (args: Record<string, unknown>) => Promise<unknown> };

    const result = await searchTool.execute({ query: 'hello' });

    expect(callToolSpy).toHaveBeenCalledWith('search', { query: 'hello' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] });
  });

  it('returns error object when callTool fails', async () => {
    const callToolSpy = vi.fn().mockRejectedValue(new Error('Connection refused'));
    (client as unknown as { callTool: typeof callToolSpy }).callTool = callToolSpy;

    const tools = mcpToolsToAiTools(client, [sampleTools[0]], 'mcp_test_');
    const searchTool = tools['mcp_test_search'] as unknown as { execute: (args: Record<string, unknown>) => Promise<unknown> };

    const result = await searchTool.execute({ query: 'hello' });

    expect(result).toEqual({ error: 'Connection refused' });
  });
});
