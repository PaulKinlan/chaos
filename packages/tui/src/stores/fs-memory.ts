/**
 * Re-exports FilesystemMemoryStore from agent-do.
 */

import { FilesystemMemoryStore } from 'agent-do';
import type { MemoryStore } from 'agent-do';

export function createFsMemoryStore(baseDir: string): MemoryStore {
  return new FilesystemMemoryStore(baseDir);
}
