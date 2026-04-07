import { describe, test, expect, beforeEach } from 'vitest';
import type { SettingsStore } from '../../src/stores/index.js';
import { InMemorySettingsStore } from '../../src/stores/in-memory.js';

function settingsStoreConformance(createStore: () => SettingsStore) {
  let store: SettingsStore;

  beforeEach(() => {
    store = createStore();
  });

  test('get returns undefined for missing key', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('set and get a string value', async () => {
    await store.set('theme', 'dark');
    const result = await store.get<string>('theme');
    expect(result).toBe('dark');
  });

  test('set and get an object value', async () => {
    const settings = { activeProvider: 'anthropic', theme: 'dark' };
    await store.set('settings', settings);
    const result = await store.get<typeof settings>('settings');
    expect(result).toEqual(settings);
  });

  test('set overwrites existing value', async () => {
    await store.set('key', 'first');
    await store.set('key', 'second');
    const result = await store.get<string>('key');
    expect(result).toBe('second');
  });

  test('remove deletes a key', async () => {
    await store.set('key', 'value');
    await store.remove('key');
    const result = await store.get('key');
    expect(result).toBeUndefined();
  });

  test('remove on nonexistent key does not throw', async () => {
    await expect(store.remove('nonexistent')).resolves.toBeUndefined();
  });

  test('getMultiple returns values for existing keys', async () => {
    await store.set('a', 1);
    await store.set('b', 2);
    await store.set('c', 3);
    const result = await store.getMultiple<number>(['a', 'b', 'c']);
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('getMultiple omits missing keys', async () => {
    await store.set('a', 1);
    const result = await store.getMultiple<number>(['a', 'missing']);
    expect(result).toEqual({ a: 1 });
  });

  test('getMultiple with empty array returns empty object', async () => {
    const result = await store.getMultiple<unknown>([]);
    expect(result).toEqual({});
  });
}

describe('InMemorySettingsStore', () => {
  settingsStoreConformance(() => new InMemorySettingsStore());
});
