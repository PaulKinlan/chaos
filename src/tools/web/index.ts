/**
 * Web Tools Index
 *
 * Exports getWebTools() which returns all web-related tools.
 */

import type { ToolSet } from 'ai';
import { fetchPage } from './fetch-page.js';
import { webSearch } from './search.js';

/**
 * Returns all web tools as a ToolSet record.
 */
export function getWebTools(): ToolSet {
  return {
    fetch_page: fetchPage,
    web_search: webSearch,
  };
}
