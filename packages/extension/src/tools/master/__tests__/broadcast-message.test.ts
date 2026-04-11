/**
 * Tests for broadcast_message master tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBroadcastMessageTool } from '../broadcast-message.js';

// ── Mocks ──

const mockAgents = [
  { id: 'master-1', name: 'Master', visibility: 'visible' as const, role: 'coordinator' },
  { id: 'researcher', name: 'Researcher', visibility: 'visible' as const, role: 'research' },
  { id: 'writer', name: 'Writer', visibility: 'visible' as const, role: 'writing' },
  { id: 'hidden-agent', name: 'Hidden', visibility: 'private' as const, role: 'internal' },
  { id: 'analyst', name: 'Data Analyst', visibility: 'visible' as const, role: 'research and analysis' },
];

vi.mock('../../../storage/chrome-storage.js', () => ({
  getAgentList: vi.fn(() => Promise.resolve(mockAgents)),
}));

const appendMessageSpy = vi.fn<(msg: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
vi.mock('../../../storage/shared.js', () => ({
  appendMessage: (msg: Record<string, unknown>) => appendMessageSpy(msg),
}));

// ── Tests ──

describe('broadcast_message tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts to all visible non-master agents', async () => {
    const tool = createBroadcastMessageTool('master-1');
    const result = await (tool as any).execute({ body: 'Hello everyone!' });

    expect(result.ok).toBe(true);
    expect(result.recipientCount).toBe(3); // researcher, writer, analyst (not master, not hidden)
    expect(appendMessageSpy).toHaveBeenCalledTimes(3);

    const agentIds = result.deliveries.map((d: any) => d.agentId);
    expect(agentIds).toContain('researcher');
    expect(agentIds).toContain('writer');
    expect(agentIds).toContain('analyst');
    expect(agentIds).not.toContain('master-1');
    expect(agentIds).not.toContain('hidden-agent');
  });

  it('filters by role', async () => {
    const tool = createBroadcastMessageTool('master-1');
    const result = await (tool as any).execute({
      body: 'Research update',
      filter: { role: 'research' },
    });

    expect(result.ok).toBe(true);
    expect(result.recipientCount).toBe(2); // researcher + analyst (both have 'research' in role)
  });

  it('filters by specific agent IDs', async () => {
    const tool = createBroadcastMessageTool('master-1');
    const result = await (tool as any).execute({
      body: 'Just for you two',
      filter: { agentIds: ['researcher', 'writer'] },
    });

    expect(result.ok).toBe(true);
    expect(result.recipientCount).toBe(2);
  });

  it('sends individual messages with correct from/to fields', async () => {
    const tool = createBroadcastMessageTool('master-1');
    await (tool as any).execute({ body: 'Test message' });

    for (const call of appendMessageSpy.mock.calls) {
      const msg = call[0] as Record<string, unknown>;
      expect(msg['from']).toBe('master-1');
      expect(msg['body']).toBe('Test message');
      expect(msg['id']).toMatch(/^msg-/);
      expect(msg['timestamp']).toBeTruthy();
    }
  });

  it('returns empty deliveries when no agents match filter', async () => {
    const tool = createBroadcastMessageTool('master-1');
    const result = await (tool as any).execute({
      body: 'Nobody will get this',
      filter: { role: 'nonexistent-role' },
    });

    expect(result.ok).toBe(true);
    expect(result.recipientCount).toBe(0);
    expect(result.deliveries).toEqual([]);
  });
});
