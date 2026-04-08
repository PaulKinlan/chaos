import type { PermissionConfig } from './types.js';

/**
 * Evaluate whether a tool call is permitted.
 *
 * Pipeline:
 * 1. If mode is 'accept-all', return true
 * 2. If mode is 'deny-all', return false
 * 3. Check per-tool overrides: 'always' -> true, 'never' -> false
 * 4. If 'ask' or no override: call onPermissionRequest callback (default: true)
 */
export async function evaluatePermission(
  toolName: string,
  args: unknown,
  config: PermissionConfig,
): Promise<boolean> {
  // Mode-level shortcuts
  if (config.mode === 'accept-all') {
    // Still check per-tool 'never' overrides
    const toolLevel = config.tools?.[toolName];
    if (toolLevel === 'never') return false;
    return true;
  }

  if (config.mode === 'deny-all') {
    // Still check per-tool 'always' overrides
    const toolLevel = config.tools?.[toolName];
    if (toolLevel === 'always') return true;
    return false;
  }

  // Mode is 'ask' — check per-tool overrides first
  const toolLevel = config.tools?.[toolName];
  if (toolLevel === 'always') return true;
  if (toolLevel === 'never') return false;

  // 'ask' level or no override — call the callback
  if (config.onPermissionRequest) {
    return config.onPermissionRequest({ toolName, args });
  }

  // No callback provided — default to allow
  return true;
}
