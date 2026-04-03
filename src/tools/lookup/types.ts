/**
 * Tool Lookup Types
 *
 * Interfaces for the tool lookup service that resolves tools by intent
 * instead of giving agents all tools upfront.
 */

export interface ToolMeta {
  name: string;
  description: string;
  keywords: string[];
  category: 'chrome' | 'file' | 'communication' | 'wasm' | 'web' | 'hooks' | 'master';
}

export interface ToolLookup {
  register(meta: ToolMeta): void;
  resolve(intent: string, topK?: number): Promise<ToolMeta[]>;
}
