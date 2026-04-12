/**
 * Re-exports FilesystemMemoryStore from @chaos/agent-loop.
 */

import { FilesystemMemoryStore } from '@chaos/agent-loop';
import type { MemoryStore } from '@chaos/agent-loop';

export function createFsMemoryStore(baseDir: string): MemoryStore {
  return new FilesystemMemoryStore(baseDir);
}
