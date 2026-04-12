/**
 * File tools backed by any MemoryStore implementation.
 *
 * Returns Vercel AI SDK tools for read_file, write_file, list_directory,
 * delete_file, grep_file, and find_files.
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import type { MemoryStore } from '../stores.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodType): any => schema;

/**
 * Create a set of file-manipulation tools backed by a MemoryStore.
 *
 * @param store - Any MemoryStore implementation (in-memory, filesystem, etc.)
 * @param agentId - The agent ID to scope file operations to
 * @returns A ToolSet containing read_file, write_file, list_directory, delete_file, grep_file, find_files
 */
export function createFileTools(store: MemoryStore, agentId: string): ToolSet {
  return {
    read_file: tool({
      description: 'Read the contents of a file at the given path.',
      inputSchema: s(
        z.object({
          path: z.string().describe('The file path to read'),
        }),
      ),
      execute: async ({ path }: { path: string }) => {
        try {
          return await store.read(agentId, path);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    write_file: tool({
      description: 'Write content to a file at the given path. Creates parent directories as needed.',
      inputSchema: s(
        z.object({
          path: z.string().describe('The file path to write to'),
          content: z.string().describe('The content to write'),
        }),
      ),
      execute: async ({ path, content }: { path: string; content: string }) => {
        try {
          await store.write(agentId, path, content);
          return `Successfully wrote to ${path}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    list_directory: tool({
      description: 'List files and directories at the given path. Returns names and types.',
      inputSchema: s(
        z.object({
          path: z.string().optional().describe('The directory path to list (defaults to root)'),
        }),
      ),
      execute: async ({ path }: { path?: string }) => {
        try {
          const entries = await store.list(agentId, path);
          if (entries.length === 0) {
            return 'Directory is empty or does not exist.';
          }
          return entries
            .map((e) => `${e.type === 'directory' ? '[dir]' : '[file]'} ${e.name}`)
            .join('\n');
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    delete_file: tool({
      description: 'Delete a file at the given path.',
      inputSchema: s(
        z.object({
          path: z.string().describe('The file path to delete'),
        }),
      ),
      execute: async ({ path }: { path: string }) => {
        try {
          await store.delete(agentId, path);
          return `Successfully deleted ${path}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    grep_file: tool({
      description: 'Search for a text pattern across files. Returns matching file paths and lines.',
      inputSchema: s(
        z.object({
          pattern: z.string().describe('The text pattern to search for'),
          path: z.string().optional().describe('Directory to search within (defaults to root)'),
        }),
      ),
      execute: async ({ pattern, path }: { pattern: string; path?: string }) => {
        try {
          const results = await store.search(agentId, pattern, path);
          if (results.length === 0) {
            return `No matches found for "${pattern}"`;
          }
          return results
            .map((r) => `${r.path}: ${r.line}`)
            .join('\n');
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    find_files: tool({
      description: 'List all files and directories recursively from a path. Useful for discovering file structure.',
      inputSchema: s(
        z.object({
          path: z.string().optional().describe('Starting directory (defaults to root)'),
        }),
      ),
      execute: async ({ path }: { path?: string }) => {
        try {
          const result: string[] = [];
          await listRecursive(store, agentId, path ?? '', '', result);
          if (result.length === 0) {
            return 'No files found.';
          }
          return result.join('\n');
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  };
}

async function listRecursive(
  store: MemoryStore,
  agentId: string,
  basePath: string,
  prefix: string,
  result: string[],
): Promise<void> {
  const fullPath = basePath ? (prefix ? `${basePath}/${prefix}` : basePath) : prefix;
  const entries = await store.list(agentId, fullPath || undefined);
  for (const entry of entries) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push(`${entry.type === 'directory' ? '[dir]' : '[file]'} ${entryPath}`);
    if (entry.type === 'directory') {
      await listRecursive(store, agentId, basePath, entryPath, result);
    }
  }
}
