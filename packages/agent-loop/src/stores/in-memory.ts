/**
 * InMemoryMemoryStore — default in-memory implementation of MemoryStore.
 *
 * Useful for testing, prototyping, and short-lived agents that don't
 * need persistence. Data is lost when the process exits.
 *
 * For persistent storage, implement MemoryStore backed by:
 * - Node.js fs (see examples/filesystem-store.ts)
 * - S3, GCS, or other cloud storage
 * - SQLite, Firestore, DynamoDB, etc.
 * - Browser OPFS, IndexedDB, localStorage
 */

import type { MemoryStore, FileEntry } from '../stores.js';

interface FileNode {
  type: 'file' | 'directory';
  content?: string;
  children?: Map<string, FileNode>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private roots = new Map<string, FileNode>();

  private getRoot(agentId: string): FileNode {
    let root = this.roots.get(agentId);
    if (!root) {
      root = { type: 'directory', children: new Map() };
      this.roots.set(agentId, root);
    }
    return root;
  }

  private parsePath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }

  private navigate(root: FileNode, segments: string[], createDirs: boolean): FileNode | undefined {
    let current = root;
    for (const seg of segments) {
      if (!current.children) {
        if (!createDirs) return undefined;
        current.children = new Map();
      }
      let child = current.children.get(seg);
      if (!child) {
        if (!createDirs) return undefined;
        child = { type: 'directory', children: new Map() };
        current.children.set(seg, child);
      }
      current = child;
    }
    return current;
  }

  async read(agentId: string, path: string): Promise<string> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const node = this.navigate(root, segments, false);
    if (!node || node.type !== 'file' || node.content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return node.content;
  }

  async write(agentId: string, path: string, content: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const parentSegs = segments.slice(0, -1);
    const fileName = segments[segments.length - 1]!;
    const parent = this.navigate(root, parentSegs, true)!;
    if (!parent.children) parent.children = new Map();
    parent.children.set(fileName, { type: 'file', content });
  }

  async append(agentId: string, path: string, content: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    const node = this.navigate(root, segments, false);
    if (!node || node.type !== 'file') {
      await this.write(agentId, path, content);
      return;
    }
    node.content = (node.content ?? '') + content;
  }

  async delete(agentId: string, path: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    if (segments.length === 0) return;
    const parentSegs = segments.slice(0, -1);
    const name = segments[segments.length - 1]!;
    const parent = this.navigate(root, parentSegs, false);
    if (parent?.children) parent.children.delete(name);
  }

  async list(agentId: string, path?: string): Promise<FileEntry[]> {
    const root = this.getRoot(agentId);
    const segments = path ? this.parsePath(path) : [];
    const node = segments.length > 0 ? this.navigate(root, segments, false) : root;
    if (!node || !node.children) return [];
    const entries: FileEntry[] = [];
    for (const [name, child] of node.children) {
      entries.push({ name, type: child.type });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(agentId: string, path: string): Promise<void> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    this.navigate(root, segments, true);
  }

  async exists(agentId: string, path: string): Promise<boolean> {
    const segments = this.parsePath(path);
    const root = this.getRoot(agentId);
    return this.navigate(root, segments, false) !== undefined;
  }

  async search(agentId: string, pattern: string, path?: string): Promise<Array<{ path: string; line: string }>> {
    const results: Array<{ path: string; line: string }> = [];
    const root = this.getRoot(agentId);
    const segments = path ? this.parsePath(path) : [];
    const startNode = segments.length > 0 ? this.navigate(root, segments, false) : root;
    if (!startNode) return results;

    const prefix = path ? path.replace(/\/$/, '') + '/' : '';
    this.searchNode(startNode, prefix, pattern, results);
    return results;
  }

  private searchNode(
    node: FileNode, currentPath: string, pattern: string,
    results: Array<{ path: string; line: string }>,
  ): void {
    if (node.type === 'file' && node.content) {
      for (const line of node.content.split('\n')) {
        if (line.includes(pattern)) {
          results.push({ path: currentPath.replace(/\/$/, ''), line });
        }
      }
    }
    if (node.children) {
      for (const [name, child] of node.children) {
        this.searchNode(child, currentPath + name + (child.type === 'directory' ? '/' : ''), pattern, results);
      }
    }
  }
}
