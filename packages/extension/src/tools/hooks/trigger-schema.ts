/**
 * Shared Zod schema for hook trigger types.
 *
 * IMPORTANT: Keep this in sync with HookTrigger in storage/types.ts.
 * When you add a new trigger type to the TypeScript type, add it here too.
 */

import { z } from 'zod';

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bookmark-created'),
    folderId: z.string().optional(),
    folderName: z.string().optional(),
  }),
  z.object({
    type: z.literal('tab-navigated'),
    urlPattern: z.string(),
  }),
  z.object({ type: z.literal('tab-created') }),
  z.object({ type: z.literal('tab-closed') }),
  z.object({
    type: z.literal('download-completed'),
    filenamePattern: z.string().optional(),
  }),
  z.object({
    type: z.literal('history-visited'),
    urlPattern: z.string(),
  }),
  z.object({
    type: z.literal('idle-changed'),
    state: z.enum(['active', 'idle', 'locked']),
  }),
  z.object({ type: z.literal('browser-startup') }),
  z.object({
    type: z.literal('omnibox'),
    keyword: z.string(),
  }),
  z.object({ type: z.literal('reading-list-changed') }),
  z.object({ type: z.literal('window-created') }),
  z.object({ type: z.literal('window-focused') }),
  z.object({ type: z.literal('window-closed') }),
  z.object({
    type: z.literal('context-menu'),
    label: z.string().describe('Label for the context menu item'),
  }),
  z.object({ type: z.literal('clipboard-changed') }),
  z.object({
    type: z.literal('filesystem-changed'),
    path: z.string().optional().describe('Directory to watch for changes'),
  }),
]);
