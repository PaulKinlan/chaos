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
import { tabFocus } from './tab-focus.js';
import { tabNavigate } from './tab-navigate.js';
import { tabScreenshot } from './tab-screenshot.js';
import { tabDuplicate } from './tab-duplicate.js';
import { tabPin } from './tab-pin.js';
import { tabMute } from './tab-mute.js';
import { tabMove } from './tab-move.js';
import { createBookmarkAdd } from './bookmark-add.js';
import { bookmarkSearch } from './bookmark-search.js';
import { createBookmarkList } from './bookmark-list.js';
import { bookmarkRemove } from './bookmark-remove.js';
import { historySearch } from './history-search.js';
import { createAlarmSet } from './alarm-set.js';
import { createAlarmClear } from './alarm-clear.js';
import { createAlarmList } from './alarm-list.js';
import { notificationShow } from './notification-show.js';
import { clipboardWrite } from './clipboard-write.js';
import { windowCreate } from './window-create.js';
import { windowList } from './window-list.js';
import { windowFocus } from './window-focus.js';
import { windowClose } from './window-close.js';
import { windowResize } from './window-resize.js';
import { downloadFile } from './download-file.js';
import { downloadList } from './download-list.js';
import { readingListAdd } from './reading-list-add.js';
import { readingListQuery } from './reading-list-query.js';
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

  // Window tools — no special permission needed
  tools.window_create = windowCreate;
  tools.window_list = windowList;
  tools.window_focus = windowFocus;
  tools.window_close = windowClose;
  tools.window_resize = windowResize;

  // Tab tools need 'tabs' permission
  if (await hasPermission('tabs')) {
    tools.tab_read = tabRead;
    tools.tab_open = tabOpen;
    tools.tab_close = tabClose;
    tools.tab_list = tabList;
    tools.tab_group = tabGroup;
    tools.tab_focus = tabFocus;
    tools.tab_navigate = tabNavigate;
    tools.tab_screenshot = tabScreenshot;
    tools.tab_duplicate = tabDuplicate;
    tools.tab_pin = tabPin;
    tools.tab_mute = tabMute;
    tools.tab_move = tabMove;
  }

  // Bookmark tools need 'bookmarks' permission
  if (await hasPermission('bookmarks')) {
    tools.bookmark_add = createBookmarkAdd(agentId);
    tools.bookmark_search = bookmarkSearch;
    tools.bookmark_list = createBookmarkList(agentId);
    tools.bookmark_remove = bookmarkRemove;
  }

  // History tools need 'history' permission
  if (await hasPermission('history')) {
    tools.history_search = historySearch;
  }

  // Notification tool needs 'notifications' permission
  if (await hasPermission('notifications')) {
    tools.notification_show = notificationShow;
  }

  // Download tools need 'downloads' permission
  if (await hasPermission('downloads')) {
    tools.download_file = downloadFile;
    tools.download_list = downloadList;
  }

  // Reading list tools need 'readingList' permission
  if (await hasPermission('readingList')) {
    tools.reading_list_add = readingListAdd;
    tools.reading_list_query = readingListQuery;
  }

  // Clipboard tool (no special permission needed, but may fail in SW context)
  tools.clipboard_write = clipboardWrite;

  return tools;
}
