/**
 * Store interfaces for the agent loop.
 * MemoryStore is the primary storage abstraction for agent file operations.
 */

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface MemoryStore {
  read(agentId: string, path: string): Promise<string>;
  write(agentId: string, path: string, content: string): Promise<void>;
  append(agentId: string, path: string, content: string): Promise<void>;
  delete(agentId: string, path: string): Promise<void>;
  list(agentId: string, path?: string): Promise<FileEntry[]>;
  mkdir(agentId: string, path: string): Promise<void>;
  exists(agentId: string, path: string): Promise<boolean>;
  search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>>;
}
