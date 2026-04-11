/**
 * MCP server configuration storage.
 *
 * Stores MCP server entries in chrome.storage.local under 'chaos:mcp-servers'.
 * API keys and auth tokens are sensitive and never stored in sync storage.
 */

// ── Types ──

export interface McpServerEntry {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  global: boolean;       // true = available to all agents, false = per-agent
  agentId?: string;      // set when global=false
}

// ── Storage key ──

const STORAGE_KEY = 'chaos:mcp-servers';

// ── CRUD operations ──

/**
 * Get all configured MCP servers.
 */
export async function getMcpServers(): Promise<McpServerEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const servers = result[STORAGE_KEY];
    if (!Array.isArray(servers)) return [];
    return servers as McpServerEntry[];
  } catch (err) {
    console.error('[mcp-config] Failed to read MCP servers:', err);
    return [];
  }
}

/**
 * Save the full list of MCP servers (replaces all).
 */
export async function saveMcpServers(servers: McpServerEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: servers });
  console.log(`[mcp-config] Saved ${servers.length} MCP server(s)`);
}

/**
 * Add a new MCP server entry.
 */
export async function addMcpServer(server: McpServerEntry): Promise<void> {
  const servers = await getMcpServers();
  // Replace if same id already exists
  const filtered = servers.filter(s => s.id !== server.id);
  filtered.push(server);
  await saveMcpServers(filtered);
  console.log(`[mcp-config] Added MCP server: ${server.name} (${server.id})`);
}

/**
 * Remove an MCP server by ID.
 */
export async function removeMcpServer(id: string): Promise<void> {
  const servers = await getMcpServers();
  const filtered = servers.filter(s => s.id !== id);
  await saveMcpServers(filtered);
  console.log(`[mcp-config] Removed MCP server: ${id}`);
}

/**
 * Update an MCP server by ID with partial updates.
 */
export async function updateMcpServer(id: string, updates: Partial<McpServerEntry>): Promise<void> {
  const servers = await getMcpServers();
  const server = servers.find(s => s.id === id);
  if (server) {
    Object.assign(server, updates);
    await saveMcpServers(servers);
    console.log(`[mcp-config] Updated MCP server: ${id}`);
  } else {
    console.warn(`[mcp-config] Server not found for update: ${id}`);
  }
}
