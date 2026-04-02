/**
 * Chrome Tools Index
 *
 * Exports getChromeTools() which returns all Chrome API tools as a record,
 * with the agentId baked into bookmark and alarm tools that need it.
 */

import type { ToolSet } from 'ai';
import { tabRead } from './tab-read.js';
import { tabOpen } from './tab-open.js';
import { tabClose } from './tab-close.js';
import { tabList } from './tab-list.js';
import { tabGroup } from './tab-group.js';
import { createBookmarkAdd } from './bookmark-add.js';
import { bookmarkSearch } from './bookmark-search.js';
import { createBookmarkList } from './bookmark-list.js';
import { historySearch } from './history-search.js';
import { createAlarmSet } from './alarm-set.js';
import { createAlarmClear } from './alarm-clear.js';
import { createAlarmList } from './alarm-list.js';
import { hasPermission } from '../../permissions.js';

/**
 * Returns Chrome API tools as a ToolSet record.
 * Only includes tools for which the required permissions are granted.
 * Tools that need agent-scoping (bookmarks, alarms) have the agentId baked in.
 * Alarms use a required permission so are always included.
 */
export async function getChromeTools(agentId: string): Promise<ToolSet> {
  const tools: ToolSet = {
    // Alarms only need the 'alarms' permission which is required
    alarm_set: createAlarmSet(agentId),
    alarm_clear: createAlarmClear(agentId),
    alarm_list: createAlarmList(agentId),
  };

  // Tab tools need 'tabs' permission
  if (await hasPermission('tabs')) {
    tools.tab_read = tabRead;
    tools.tab_open = tabOpen;
    tools.tab_close = tabClose;
    tools.tab_list = tabList;
    tools.tab_group = tabGroup;
  }

  // Bookmark tools need 'bookmarks' permission
  if (await hasPermission('bookmarks')) {
    tools.bookmark_add = createBookmarkAdd(agentId);
    tools.bookmark_search = bookmarkSearch;
    tools.bookmark_list = createBookmarkList(agentId);
  }

  // History tools need 'history' permission
  if (await hasPermission('history')) {
    tools.history_search = historySearch;
  }

  return tools;
}
