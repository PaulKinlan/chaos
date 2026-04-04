/**
 * OPFS (Origin Private File System) wrapper.
 *
 * All paths are relative to the OPFS root. Nested directories are created
 * automatically when writing files.
 */

export class OPFS {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

  /** Get the OPFS root directory handle, cached for the lifetime of this instance. */
  private async root(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = navigator.storage.getDirectory();
    }
    return this.rootPromise;
  }

  // ── Path helpers ──

  /**
   * Split a path into segments, filtering out empty strings and normalising
   * away leading/trailing slashes.
   */
  static splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }

  /**
   * Resolve a directory handle for the *parent* of the given path, optionally
   * creating intermediate directories.
   *
   * Returns [parentDir, fileName].
   */
  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const segments = OPFS.splitPath(path);
    if (segments.length === 0) {
      throw new Error(`Invalid path: "${path}"`);
    }

    const fileName = segments.pop()!;
    let dir = await this.root();

    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }

    return [dir, fileName];
  }

  /**
   * Resolve a directory handle for the full path (the path itself is a
   * directory), optionally creating intermediate directories.
   */
  private async resolveDir(
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const segments = OPFS.splitPath(path);
    let dir = await this.root();

    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }

    return dir;
  }

  // ── Public API ──

  /** Read an entire file as UTF-8 text. */
  async readFile(path: string): Promise<string> {
    const [dir, name] = await this.resolveParent(path, false);
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
  }

  /** Write (create or overwrite) a file with the given content. Creates parent dirs. */
  async writeFile(path: string, content: string): Promise<void> {
    const [dir, name] = await this.resolveParent(path, true);
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Append content to a file. Creates the file (and parent dirs) if it
   * doesn't exist. This is the recommended way to write to JSONL logs.
   */
  async appendFile(path: string, content: string): Promise<void> {
    const [dir, name] = await this.resolveParent(path, true);
    const fileHandle = await dir.getFileHandle(name, { create: true });

    // Read existing content first so we can append
    const file = await fileHandle.getFile();
    const existing = await file.text();

    const writable = await fileHandle.createWritable();
    await writable.write(existing + content);
    await writable.close();
  }

  /**
   * Read lines from a file. If `lastN` is provided, returns only the last N
   * non-empty lines (useful for tailing JSONL logs).
   */
  async readLines(path: string, lastN?: number): Promise<string[]> {
    const text = await this.readFile(path);
    const lines = text.split('\n').filter((l) => l.length > 0);

    if (lastN !== undefined && lastN > 0) {
      return lines.slice(-lastN);
    }

    return lines;
  }

  /** List entries (files and directories) in a directory. */
  async listDir(path: string): Promise<string[]> {
    const dir = await this.resolveDir(path, false);
    const entries: string[] = [];

    for await (const [name] of (dir as any).entries()) {
      entries.push(name);
    }

    return entries.sort();
  }

  /** Create a directory (and any missing parents). */
  async mkdir(path: string): Promise<void> {
    await this.resolveDir(path, true);
  }

  /** Delete a file or directory (recursively). */
  async delete(path: string): Promise<void> {
    const segments = OPFS.splitPath(path);
    if (segments.length === 0) {
      throw new Error('Cannot delete the root directory');
    }

    const name = segments.pop()!;
    let dir = await this.root();

    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: false });
    }

    await dir.removeEntry(name, { recursive: true });
  }

  /** Check whether a file or directory exists at the given path. */
  async exists(path: string): Promise<boolean> {
    try {
      const segments = OPFS.splitPath(path);
      if (segments.length === 0) {
        return true; // root always exists
      }

      const name = segments.pop()!;
      let dir = await this.root();

      for (const segment of segments) {
        dir = await dir.getDirectoryHandle(segment, { create: false });
      }

      // Try as file first, then as directory
      try {
        await dir.getFileHandle(name);
        return true;
      } catch {
        try {
          await dir.getDirectoryHandle(name, { create: false });
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
  }
}

/** Singleton instance for convenience. */
export const opfs = new OPFS();
