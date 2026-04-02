/**
 * Web Tools Index
 *
 * Exports getWebTools() which returns all web-related tools.
 */

import type { ToolSet } from 'ai';
import { fetchPage } from './fetch-page.js';
import { createWebSearch, webSearch } from './search.js';

export interface WebToolsOptions {
  braveApiKey?: string;
}

/**
 * Returns all web tools as a ToolSet record.
 * If a Brave Search API key is provided, web_search will use Brave for better results.
 */
export function getWebTools(options?: WebToolsOptions): ToolSet {
  const search = options?.braveApiKey
    ? createWebSearch(options.braveApiKey)
    : webSearch;

  return {
    fetch_page: fetchPage,
    web_search: search,
  };
}
