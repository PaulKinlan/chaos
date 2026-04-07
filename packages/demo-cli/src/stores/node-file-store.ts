import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryStore } from '@chaos/sdk/stores';
import type { FileEntry } from '@chaos/sdk';

/**
 * MemoryStore backed by the local filesystem.
 * Each agent gets a subdirectory under the base dir.
 */
export class NodeFileStore implements MemoryStore {
  constructor(private baseDir: string) {}

  private resolvePath(agentId: string, filePath: string): string {
    return path.join(this.baseDir, agentId, filePath);
  }

  async read(agentId: string, filePath: string): Promise<string> {
    const full = this.resolvePath(agentId, filePath);
    return fs.readFile(full, 'utf-8');
  }

  async write(agentId: string, filePath: string, content: string): Promise<void> {
    const full = this.resolvePath(agentId, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async append(agentId: string, filePath: string, content: string): Promise<void> {
    const full = this.resolvePath(agentId, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, content, 'utf-8');
  }

  async delete(agentId: string, filePath: string): Promise<void> {
    const full = this.resolvePath(agentId, filePath);
    await fs.unlink(full).catch(() => {});
  }

  async list(agentId: string, dirPath?: string): Promise<FileEntry[]> {
    const full = this.resolvePath(agentId, dirPath ?? '');
    try {
      const entries = await fs.readdir(full, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' as const : 'file' as const,
      })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async mkdir(agentId: string, dirPath: string): Promise<void> {
    const full = this.resolvePath(agentId, dirPath);
    await fs.mkdir(full, { recursive: true });
  }

  async exists(agentId: string, filePath: string): Promise<boolean> {
    const full = this.resolvePath(agentId, filePath);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }

  async search(agentId: string, pattern: string, dirPath?: string): Promise<Array<{ path: string; line: string }>> {
    const results: Array<{ path: string; line: string }> = [];
    const rootDir = this.resolvePath(agentId, dirPath ?? '');
    await this.searchDir(rootDir, rootDir, pattern, results);
    return results;
  }

  private async searchDir(
    rootDir: string,
    currentDir: string,
    pattern: string,
    results: Array<{ path: string; line: string }>,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.searchDir(rootDir, full, pattern, results);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(full, 'utf-8');
          const lines = content.split('\n');
          const relPath = path.relative(rootDir, full);
          for (const line of lines) {
            if (line.includes(pattern)) {
              results.push({ path: relPath, line });
            }
          }
        } catch {
          // skip binary / unreadable files
        }
      }
    }
  }
}
