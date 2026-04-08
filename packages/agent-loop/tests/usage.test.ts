import { describe, it, expect, vi } from 'vitest';
import { UsageTracker, estimateCost, DEFAULT_PRICING } from '../src/usage.js';

describe('estimateCost', () => {
  it('calculates cost for known model', () => {
    // claude-sonnet-4-6: input 3.0/1M, output 15.0/1M
    const cost = estimateCost('claude-sonnet-4-6', 1000, 500);
    // (1000/1M)*3.0 + (500/1M)*15.0 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model', 1000, 500)).toBe(0);
  });

  it('uses custom pricing table', () => {
    const pricing = { 'my-model': { input: 10.0, output: 20.0 } };
    const cost = estimateCost('my-model', 1_000_000, 1_000_000, pricing);
    expect(cost).toBe(30.0);
  });

  it('handles OpenRouter-style model IDs', () => {
    const cost = estimateCost('anthropic/claude-sonnet-4-6', 1000, 500);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('handles prefix matching', () => {
    // "claude-sonnet-4-6-20260301" should match "claude-sonnet-4-6"
    const cost = estimateCost('claude-sonnet-4-6-20260301', 1000, 500);
    expect(cost).toBeCloseTo(0.0105, 6);
  });
});

describe('UsageTracker', () => {
  it('accumulates records correctly', () => {
    const tracker = new UsageTracker();
    tracker.record(0, 'claude-sonnet-4-6', 1000, 500);
    tracker.record(1, 'claude-sonnet-4-6', 2000, 1000);

    const summary = tracker.getSummary();
    expect(summary.totalInputTokens).toBe(3000);
    expect(summary.totalOutputTokens).toBe(1500);
    expect(summary.steps).toBe(2);
    expect(summary.records).toHaveLength(2);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it('per-run limit enforcement', async () => {
    const tracker = new UsageTracker({ perRunLimit: 0.001 });
    // Record enough to exceed limit
    tracker.record(0, 'claude-sonnet-4-6', 10000, 5000);

    const ok = await tracker.checkLimits();
    expect(ok).toBe(false);
  });

  it('per-run limit with callback override', async () => {
    const callback = vi.fn().mockResolvedValue(true);
    const tracker = new UsageTracker({
      perRunLimit: 0.001,
      onLimitExceeded: callback,
    });
    tracker.record(0, 'claude-sonnet-4-6', 10000, 5000);

    const ok = await tracker.checkLimits();
    expect(ok).toBe(true);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'perRun' }),
    );
  });

  it('per-day limit enforcement', async () => {
    const tracker = new UsageTracker({ perDayLimit: 0.001 });
    tracker.record(0, 'claude-sonnet-4-6', 10000, 5000);

    const ok = await tracker.checkLimits();
    expect(ok).toBe(false);
  });

  it('within limits returns true', async () => {
    const tracker = new UsageTracker({ perRunLimit: 100.0 });
    tracker.record(0, 'claude-sonnet-4-6', 100, 50);

    const ok = await tracker.checkLimits();
    expect(ok).toBe(true);
  });
});

describe('DEFAULT_PRICING', () => {
  it('has entries for major providers', () => {
    expect(DEFAULT_PRICING).toHaveProperty('claude-sonnet-4-6');
    expect(DEFAULT_PRICING).toHaveProperty('gpt-4o');
    expect(DEFAULT_PRICING).toHaveProperty('gemini-2.5-pro');
    expect(DEFAULT_PRICING).toHaveProperty('mistral-large');
  });
});
