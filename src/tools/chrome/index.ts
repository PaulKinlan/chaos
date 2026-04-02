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

/**
 * Returns all Chrome API tools as a ToolSet record.
 * Tools that need agent-scoping (bookmarks, alarms) have the agentId baked in.
 */
export function getChromeTools(agentId: string): ToolSet {
  return {
    tab_read: tabRead,
    tab_open: tabOpen,
    tab_close: tabClose,
    tab_list: tabList,
    tab_group: tabGroup,
    bookmark_add: createBookmarkAdd(agentId),
    bookmark_search: bookmarkSearch,
    bookmark_list: createBookmarkList(agentId),
    history_search: historySearch,
    alarm_set: createAlarmSet(agentId),
    alarm_clear: createAlarmClear(agentId),
    alarm_list: createAlarmList(agentId),
  };
}
