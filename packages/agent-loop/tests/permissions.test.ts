import { describe, it, expect, vi } from 'vitest';
import { evaluatePermission } from '../src/permissions.js';
import type { PermissionConfig } from '../src/types.js';

describe('evaluatePermission', () => {
  it('accept-all mode returns true', async () => {
    const config: PermissionConfig = { mode: 'accept-all' };
    expect(await evaluatePermission('any_tool', {}, config)).toBe(true);
  });

  it('deny-all mode returns false', async () => {
    const config: PermissionConfig = { mode: 'deny-all' };
    expect(await evaluatePermission('any_tool', {}, config)).toBe(false);
  });

  it('accept-all with per-tool never override returns false', async () => {
    const config: PermissionConfig = {
      mode: 'accept-all',
      tools: { dangerous_tool: 'never' },
    };
    expect(await evaluatePermission('dangerous_tool', {}, config)).toBe(false);
    expect(await evaluatePermission('safe_tool', {}, config)).toBe(true);
  });

  it('deny-all with per-tool always override returns true', async () => {
    const config: PermissionConfig = {
      mode: 'deny-all',
      tools: { safe_tool: 'always' },
    };
    expect(await evaluatePermission('safe_tool', {}, config)).toBe(true);
    expect(await evaluatePermission('other_tool', {}, config)).toBe(false);
  });

  it('ask mode with always override returns true', async () => {
    const config: PermissionConfig = {
      mode: 'ask',
      tools: { read_file: 'always' },
    };
    expect(await evaluatePermission('read_file', {}, config)).toBe(true);
  });

  it('ask mode with never override returns false', async () => {
    const config: PermissionConfig = {
      mode: 'ask',
      tools: { delete_file: 'never' },
    };
    expect(await evaluatePermission('delete_file', {}, config)).toBe(false);
  });

  it('ask mode calls onPermissionRequest callback', async () => {
    const callback = vi.fn().mockResolvedValue(true);
    const config: PermissionConfig = {
      mode: 'ask',
      onPermissionRequest: callback,
    };
    const result = await evaluatePermission('some_tool', { foo: 'bar' }, config);
    expect(result).toBe(true);
    expect(callback).toHaveBeenCalledWith({
      toolName: 'some_tool',
      args: { foo: 'bar' },
    });
  });

  it('ask mode with callback returning false denies', async () => {
    const config: PermissionConfig = {
      mode: 'ask',
      onPermissionRequest: async () => false,
    };
    expect(await evaluatePermission('tool', {}, config)).toBe(false);
  });

  it('ask mode with no callback defaults to true', async () => {
    const config: PermissionConfig = { mode: 'ask' };
    expect(await evaluatePermission('tool', {}, config)).toBe(true);
  });
});
