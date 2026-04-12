/**
 * FilesystemMemoryStore — Node.js filesystem-backed MemoryStore.
 *
 * Stores agent files in {baseDir}/{agentId}/ on the local filesystem.
 * Files persist across process restarts.
 *
 * Usage:
 *   import { FilesystemMemoryStore } from '@chaos/agent-loop/stores/filesystem';
 *   const store = new FilesystemMemoryStore('/path/to/data');
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryStore, FileEntry } from '../stores.js';

export class FilesystemMemoryStore implements MemoryStore {
  constructor(private baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private resolve(agentId: string, filePath: string): string {
    const agentDir = path.resolve(this.baseDir, agentId);
    const resolved = path.resolve(agentDir, filePath);
    if (!resolved.startsWith(path.resolve(this.baseDir))) {
      throw new Error('Path traversal not allowed');
    }
    return resolved;
  }

  async read(agentId: string, filePath: string): Promise<string> {
    const full = this.resolve(agentId, filePath);
    if (!fs.existsSync(full)) throw new Error(`File not found: ${filePath}`);
    return fs.readFileSync(full, 'utf-8');
  }

  async write(agentId: string, filePath: string, content: string): Promise<void> {
    const full = this.resolve(agentId, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }

  async append(agentId: string, filePath: string, content: string): Promise<void> {
    const full = this.resolve(agentId, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, content, 'utf-8');
  }

  async delete(agentId: string, filePath: string): Promise<void> {
    const full = this.resolve(agentId, filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  async list(agentId: string, dirPath?: string): Promise<FileEntry[]> {
    const full = this.resolve(agentId, dirPath || '.');
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' as const : 'file' as const,
      size: e.isFile() ? fs.statSync(path.join(full, e.name)).size : undefined,
    }));
  }

  async mkdir(agentId: string, dirPath: string): Promise<void> {
    fs.mkdirSync(this.resolve(agentId, dirPath), { recursive: true });
  }

  async exists(agentId: string, filePath: string): Promise<boolean> {
    return fs.existsSync(this.resolve(agentId, filePath));
  }

  async search(agentId: string, pattern: string, dirPath?: string): Promise<Array<{ path: string; line: string }>> {
    const results: Array<{ path: string; line: string }> = [];
    const searchDir = this.resolve(agentId, dirPath || '.');
    this.searchRecursive(searchDir, this.resolve(agentId, '.'), pattern, results);
    return results;
  }

  private searchRecursive(
    dir: string, baseDir: string, pattern: string,
    results: Array<{ path: string; line: string }>,
  ): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          this.searchRecursive(full, baseDir, pattern, results);
        }
      } else {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const regex = new RegExp(pattern, 'gi');
          for (const line of content.split('\n')) {
            if (regex.test(line)) {
              results.push({ path: path.relative(baseDir, full), line: line.trim() });
              if (results.length >= 100) return;
            }
            regex.lastIndex = 0;
          }
        } catch { /* skip binary files */ }
      }
    }
  }
}
