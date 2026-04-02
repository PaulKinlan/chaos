/**
 * Type declarations for the Chrome Reading List API.
 *
 * The @types/chrome package does not yet include readingList types.
 * See: https://developer.chrome.com/docs/extensions/reference/api/readingList
 */

declare namespace chrome {
  export namespace readingList {
    export interface ReadingListEntry {
      url: string;
      title: string;
      hasBeenRead: boolean;
      creationTime: number;
      lastUpdateTime: number;
    }

    export interface AddEntryOptions {
      url: string;
      title: string;
      hasBeenRead: boolean;
    }

    export interface QueryOptions {
      url?: string;
      title?: string;
      hasBeenRead?: boolean;
    }

    export function addEntry(entry: AddEntryOptions): Promise<void>;
    export function query(query: QueryOptions): Promise<ReadingListEntry[]>;
    export function removeEntry(info: { url: string }): Promise<void>;
    export function updateEntry(info: { url: string; title?: string; hasBeenRead?: boolean }): Promise<void>;
  }
}
