/**
 * Tool Permission System
 *
 * Manages always/ask/never permissions for each tool.
 * Permissions are stored in chrome.storage.local.
 */

export type PermissionLevel = 'always' | 'ask' | 'never';

export interface ToolPermissions {
  [toolName: string]: PermissionLevel;
}

const STORAGE_KEY = 'chaos:toolPermissions';

export const DEFAULT_PERMISSIONS: ToolPermissions = {
  // Safe/read-only tools default to 'always'
  read_file: 'always',
  list_directory: 'always',
  tab_list: 'always',
  bookmark_search: 'always',
  bookmark_list: 'always',
  history_search: 'always',
  alarm_list: 'always',
  message_read: 'always',
  task_list: 'always',
  artifact_list: 'always',
  artifact_read: 'always',
  agent_discover: 'always',

  // Destructive/active tools default to 'ask'
  write_file: 'ask',
  edit_file: 'ask',
  append_file: 'ask',
  mkdir: 'ask',
  tab_open: 'ask',
  tab_close: 'ask',
  tab_group: 'ask',
  bookmark_add: 'ask',
  alarm_set: 'ask',
  alarm_clear: 'ask',
  message_send: 'ask',
  task_create: 'ask',
  task_update: 'ask',
  artifact_publish: 'ask',
  fetch_page: 'ask',
};

/**
 * Get the stored permissions, merged with defaults.
 */
export async function getAllPermissions(): Promise<ToolPermissions> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as ToolPermissions | undefined) ?? {};
  return { ...DEFAULT_PERMISSIONS, ...stored };
}

/**
 * Get the permission level for a specific tool.
 */
export async function getPermission(toolName: string): Promise<PermissionLevel> {
  const perms = await getAllPermissions();
  return perms[toolName] ?? 'ask';
}

/**
 * Set the permission level for a specific tool.
 */
export async function setPermission(
  toolName: string,
  level: PermissionLevel,
): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as ToolPermissions | undefined) ?? {};
  stored[toolName] = level;
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

/**
 * Check whether a tool is allowed to execute.
 *
 * Returns true if allowed, false if denied.
 * For 'ask' permission level, currently defaults to allowing execution.
 *
 * TODO: Wire up UI prompt for 'ask' tools. When the UI integration is
 * ready, this function should send a message to the side panel to
 * prompt the user and await their response before returning.
 */
export async function checkPermission(toolName: string): Promise<boolean> {
  const level = await getPermission(toolName);

  switch (level) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'ask':
      // TODO: Send a message to the UI to prompt the user for permission.
      // For now, default to allowing execution since we don't have the
      // UI prompt wired up yet.
      return true;
    default:
      return false;
  }
}
