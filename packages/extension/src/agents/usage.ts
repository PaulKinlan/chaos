/**
 * Token usage tracking and cost estimation.
 *
 * Records LLM usage per request, stores in chrome.storage.local
 * with a rolling 7-day window. Provides aggregation by agent,
 * provider, and time range.
 */

import { estimateCost } from './pricing.js';
import type { ProviderId } from './provider-registry.js';

export interface UsageRecord {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  source: 'chat' | 'hook' | 'channel' | 'task' | 'message' | 'refine';
}

const STORAGE_KEY = 'chaos:usage';
const MAX_RECORDS = 5000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Record a usage event from an LLM call.
 */
export async function recordUsage(params: {
  agentId: string;
  agentName: string;
  provider: ProviderId;
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  source: UsageRecord['source'];
}): Promise<void> {
  const inputTokens = params.inputTokens ?? 0;
  const outputTokens = params.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return; // nothing to record

  const record: UsageRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agentId: params.agentId,
    agentName: params.agentName,
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: estimateCost(params.model, inputTokens, outputTokens),
    source: params.source,
  };

  const records = await getUsageRecords();
  records.push(record);

  // Trim: remove expired + cap at MAX_RECORDS
  const cutoff = Date.now() - RETENTION_MS;
  const trimmed = records
    .filter((r) => new Date(r.timestamp).getTime() > cutoff)
    .slice(-MAX_RECORDS);

  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });

  console.log(
    `[usage] Recorded: ${record.agentName} (${record.provider}/${record.model}) ` +
    `in=${inputTokens} out=${outputTokens} cost=$${record.estimatedCost.toFixed(4)} source=${record.source}`,
  );
}

/**
 * Get all stored usage records.
 */
export async function getUsageRecords(): Promise<UsageRecord[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as UsageRecord[]) || [];
}

/**
 * Get usage records filtered by options.
 */
export async function getUsage(options?: {
  agentId?: string;
  provider?: string;
  since?: string;
  limit?: number;
}): Promise<UsageRecord[]> {
  let records = await getUsageRecords();

  if (options?.agentId) {
    records = records.filter((r) => r.agentId === options.agentId);
  }
  if (options?.provider) {
    records = records.filter((r) => r.provider === options.provider);
  }
  if (options?.since) {
    const sinceTime = new Date(options.since).getTime();
    records = records.filter((r) => new Date(r.timestamp).getTime() >= sinceTime);
  }

  // Most recent first
  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (options?.limit) {
    records = records.slice(0, options.limit);
  }

  return records;
}

export interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byAgent: Record<string, { name: string; cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  byModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; requests: number }>;
}

/**
 * Get aggregated usage summary for a time range.
 */
export async function getUsageSummary(since?: string): Promise<UsageSummary> {
  const records = since ? await getUsage({ since }) : await getUsageRecords();

  const summary: UsageSummary = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: records.length,
    byProvider: {},
    byAgent: {},
    byModel: {},
  };

  for (const r of records) {
    summary.totalCost += r.estimatedCost;
    summary.totalInputTokens += r.inputTokens;
    summary.totalOutputTokens += r.outputTokens;

    // By provider
    if (!summary.byProvider[r.provider]) {
      summary.byProvider[r.provider] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    summary.byProvider[r.provider].cost += r.estimatedCost;
    summary.byProvider[r.provider].inputTokens += r.inputTokens;
    summary.byProvider[r.provider].outputTokens += r.outputTokens;
    summary.byProvider[r.provider].requests += 1;

    // By agent
    if (!summary.byAgent[r.agentId]) {
      summary.byAgent[r.agentId] = { name: r.agentName, cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    summary.byAgent[r.agentId].cost += r.estimatedCost;
    summary.byAgent[r.agentId].inputTokens += r.inputTokens;
    summary.byAgent[r.agentId].outputTokens += r.outputTokens;
    summary.byAgent[r.agentId].requests += 1;
    summary.byAgent[r.agentId].name = r.agentName; // keep latest name

    // By model
    if (!summary.byModel[r.model]) {
      summary.byModel[r.model] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    summary.byModel[r.model].cost += r.estimatedCost;
    summary.byModel[r.model].inputTokens += r.inputTokens;
    summary.byModel[r.model].outputTokens += r.outputTokens;
    summary.byModel[r.model].requests += 1;
  }

  return summary;
}

/**
 * Clear all usage records.
 */
export async function clearUsage(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Check if an agent has exceeded its daily spending limit.
 * Returns { exceeded: true, spent, limit } if over limit, or { exceeded: false } if OK.
 */
export async function checkSpendingLimit(agentId: string): Promise<{
  exceeded: boolean;
  spent?: number;
  limit?: number;
}> {
  const key = `chaos:spending-limit:${agentId}`;
  const result = await chrome.storage.local.get(key);
  const limit = result[key] as number | undefined;
  if (limit === undefined || limit === null) return { exceeded: false };

  // Get today's spending for this agent
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const records = await getUsage({ agentId, since: todayStart.toISOString() });
  const spent = records.reduce((sum, r) => sum + r.estimatedCost, 0);

  if (spent >= limit) {
    console.warn(`[usage] Agent ${agentId} exceeded daily spending limit: $${spent.toFixed(2)} / $${limit}`);
    return { exceeded: true, spent, limit };
  }
  return { exceeded: false, spent, limit };
}
