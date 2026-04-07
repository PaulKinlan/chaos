import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SettingsStore } from '@chaos/sdk/stores';

/**
 * SettingsStore backed by a single JSON file on disk.
 */
export class JsonSettingsStore implements SettingsStore {
  private filePath: string;
  private cache: Record<string, unknown> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Record<string, unknown>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.cache ?? {}, null, 2), 'utf-8');
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = await this.load();
    return data[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await this.save();
  }

  async remove(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await this.save();
  }

  async getMultiple<T>(keys: string[]): Promise<Record<string, T>> {
    const data = await this.load();
    const result: Record<string, T> = {};
    for (const key of keys) {
      if (data[key] !== undefined) {
        result[key] = data[key] as T;
      }
    }
    return result;
  }
}
