/**
 * Filesystem-backed MemoryStore implementation for the TUI.
 * Implements @chaos/sdk MemoryStore interface.
 * Stores agent files in .chaos/{agentId}/ under the base directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryStore } from '@chaos/agent-loop';

export function createFsMemoryStore(baseDir: string): MemoryStore {
  fs.mkdirSync(baseDir, { recursive: true });

  function resolve(agentId: string, filePath: string): string {
    const agentDir = path.resolve(baseDir, agentId);
    const resolved = path.resolve(agentDir, filePath);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      throw new Error('Path traversal not allowed');
    }
    return resolved;
  }

  return {
    async read(agentId: string, filePath: string): Promise<string> {
      const full = resolve(agentId, filePath);
      return fs.readFileSync(full, 'utf-8');
    },

    async write(agentId: string, filePath: string, content: string): Promise<void> {
      const full = resolve(agentId, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    },

    async append(agentId: string, filePath: string, content: string): Promise<void> {
      const full = resolve(agentId, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.appendFileSync(full, content, 'utf-8');
    },

    async delete(agentId: string, filePath: string): Promise<void> {
      const full = resolve(agentId, filePath);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    },

    async list(agentId: string, dirPath?: string): Promise<Array<{ name: string; type: 'file' | 'directory'; size?: number }>> {
      const full = resolve(agentId, dirPath || '.');
      if (!fs.existsSync(full)) return [];
      const entries = fs.readdirSync(full, { withFileTypes: true });
      return entries.map((e) => {
        const entryPath = path.join(full, e.name);
        const stat = fs.statSync(entryPath);
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' as const : 'file' as const,
          size: stat.size,
        };
      });
    },

    async mkdir(agentId: string, dirPath: string): Promise<void> {
      const full = resolve(agentId, dirPath);
      fs.mkdirSync(full, { recursive: true });
    },

    async exists(agentId: string, filePath: string): Promise<boolean> {
      return fs.existsSync(resolve(agentId, filePath));
    },

    async search(agentId: string, pattern: string, dirPath?: string): Promise<Array<{ path: string; line: string }>> {
      // Simple grep-like search
      const searchDir = resolve(agentId, dirPath || '.');
      const results: Array<{ path: string; line: string }> = [];

      function searchRecursive(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git') {
              searchRecursive(full);
            }
          } else {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const regex = new RegExp(pattern, 'gi');
              for (const line of content.split('\n')) {
                if (regex.test(line)) {
                  results.push({
                    path: path.relative(resolve(agentId, '.'), full),
                    line: line.trim(),
                  });
                  if (results.length >= 100) return;
                }
                regex.lastIndex = 0;
              }
            } catch {
              // Skip binary files
            }
          }
        }
      }

      searchRecursive(searchDir);
      return results;
    },
  };
}
