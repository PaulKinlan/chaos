/**
 * Tab Group Tool
 *
 * Creates or adds tabs to a tab group with a title and optional color.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const tabGroup = tool({
  description:
    'Create a tab group or add tabs to an existing group. Groups tabs together with a title and optional color.',
  parameters: z.object({
    tabIds: z.array(z.number()).describe('Array of tab IDs to group together'),
    title: z.string().describe('Title for the tab group'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional()
      .describe('Color for the tab group'),
  }),
  execute: async ({ tabIds, title, color }) => {
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      const updateProps: chrome.tabGroups.UpdateProperties = { title };
      if (color) {
        updateProps.color = color;
      }
      await chrome.tabGroups.update(groupId, updateProps);
      return { groupId };
    } catch (err) {
      return {
        groupId: -1,
        error: `Failed to create tab group: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
