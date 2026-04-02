/**
 * Runtime Permission Management
 *
 * Most permissions are optional to avoid corporate install blocks.
 * Features request permissions on first use and gracefully degrade if denied.
 */

export type OptionalPermission = 'tabs' | 'bookmarks' | 'history' | 'scripting';

/**
 * Check if a permission is already granted.
 */
export async function hasPermission(permission: OptionalPermission): Promise<boolean> {
  return chrome.permissions.contains({ permissions: [permission] });
}

/**
 * Check if host permissions are granted for all URLs.
 */
export async function hasHostPermissions(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ['<all_urls>'] });
}

/**
 * Request an optional permission. Returns true if granted.
 */
export async function requestPermission(permission: OptionalPermission): Promise<boolean> {
  const already = await hasPermission(permission);
  if (already) return true;
  return chrome.permissions.request({ permissions: [permission] });
}

/**
 * Request host permissions for all URLs. Returns true if granted.
 */
export async function requestHostPermissions(): Promise<boolean> {
  const already = await hasHostPermissions();
  if (already) return true;
  return chrome.permissions.request({ origins: ['<all_urls>'] });
}

/**
 * Request permissions needed for content extraction (scripting + host).
 */
export async function requestContentExtractionPermissions(): Promise<boolean> {
  const granted = await chrome.permissions.request({
    permissions: ['scripting'],
    origins: ['<all_urls>'],
  });
  return granted;
}

/**
 * Request permissions needed for tab management.
 */
export async function requestTabPermissions(): Promise<boolean> {
  return requestPermission('tabs');
}

/**
 * Request permissions needed for bookmark features.
 */
export async function requestBookmarkPermissions(): Promise<boolean> {
  return requestPermission('bookmarks');
}

/**
 * Request permissions needed for history search.
 */
export async function requestHistoryPermissions(): Promise<boolean> {
  return requestPermission('history');
}

/**
 * Ensure a permission is available, requesting if needed.
 * Returns true if the permission is available after the check.
 * Use this as a guard before calling Chrome APIs that need optional permissions.
 */
export async function ensurePermission(permission: OptionalPermission): Promise<boolean> {
  return requestPermission(permission);
}

export async function ensureContentExtraction(): Promise<boolean> {
  return requestContentExtractionPermissions();
}
