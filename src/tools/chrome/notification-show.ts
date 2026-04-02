/**
 * Notification Show Tool
 *
 * Shows a desktop notification via the Chrome notifications API.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const notificationShow = tool({
  description:
    'Show a desktop notification with a title and message.',
  parameters: z.object({
    title: z.string().describe('The notification title'),
    message: z.string().describe('The notification body text'),
  }),
  execute: async ({ title, message }) => {
    try {
      const id = await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message,
      });
      return { shown: true, notificationId: id };
    } catch (err) {
      return {
        shown: false,
        error: `Failed to show notification: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
