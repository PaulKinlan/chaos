/**
 * MCP (Model Context Protocol) client module.
 *
 * Provides a lightweight MCP client with Streamable HTTP transport,
 * designed to work in Chrome extension service workers.
 */

export {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcMessage,
  createRequest,
  createNotification,
  isResponse,
  isNotification,
} from './jsonrpc.js';

export {
  type McpServerConfig,
  type McpConnectionState,
  type McpTool,
  type McpResource,
  type McpPromptArgument,
  type McpPromptTemplate,
  type McpResourceContents,
  type McpPromptResult,
  type McpServerCapabilities,
  type McpInitializeResult,
  McpClient,
} from './client.js';

export {
  type McpServerEntry,
  getMcpServers,
  saveMcpServers,
  addMcpServer,
  removeMcpServer,
  updateMcpServer,
} from './config.js';

export { mcpToolsToAiTools } from './tool-bridge.js';
