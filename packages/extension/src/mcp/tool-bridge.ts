/**
 * MCP Tool Bridge
 *
 * Converts MCP tool definitions to Vercel AI SDK tools.
 * Uses the AI SDK's jsonSchema() helper to pass MCP JSON Schemas
 * directly without Zod conversion.
 */

import { tool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import type { McpClient, McpTool } from './client.js';

/**
 * Convert an array of MCP tools into Vercel AI SDK tools.
 *
 * Each MCP tool becomes a namespaced AI SDK tool that delegates
 * execution to the MCP server via the client.
 *
 * @param client - Connected McpClient instance
 * @param mcpTools - Tools discovered from the MCP server
 * @param prefix - Namespace prefix (e.g. 'mcp_github_')
 * @returns Record of AI SDK tools keyed by namespaced name
 */
export function mcpToolsToAiTools(
  client: McpClient,
  mcpTools: McpTool[],
  prefix: string,
): ToolSet {
  const tools: ToolSet = {};

  for (const mcpTool of mcpTools) {
    const toolName = `${prefix}${mcpTool.name}`;
    const originalName = mcpTool.name;
    console.log(`[mcp-tool-bridge] Registering tool: ${toolName}`);

    const inputSchema = mcpTool.inputSchema && Object.keys(mcpTool.inputSchema).length > 0
      ? (mcpTool.inputSchema as Record<string, unknown>)
      : { type: 'object' as const, properties: {} };

    // Build the tool using the AI SDK's tool() helper.
    // We use `as never` casts to satisfy the strict generic constraints
    // of tool() — the JSON Schema from MCP is dynamic and cannot be
    // statically typed, but is valid at runtime.
    const aiTool = (tool as (...args: never[]) => ToolSet[string])({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      parameters: jsonSchema(inputSchema),
      execute: async (args: Record<string, unknown>) => {
        console.log(`[mcp-tool-bridge] Executing ${toolName} with args:`, args);
        try {
          const result = await client.callTool(originalName, args);
          console.log(`[mcp-tool-bridge] ${toolName} completed`);
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[mcp-tool-bridge] ${toolName} failed:`, message);
          return { error: message };
        }
      },
    } as never);

    tools[toolName] = aiTool;
  }

  return tools;
}
