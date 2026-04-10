import { signal, computed } from '@preact/signals-core';
import type { AgentMeta, ArtifactMeta, Hook } from '../storage/types.js';

// Core application state as signals
export const activeView = signal<string>('chat');
export const activeAgentId = signal<string | null>(null);
export const agents = signal<AgentMeta[]>([]);
export const focusedColumnId = signal<string | null>(null);
export const debugMode = signal<boolean>(false);

// Data signals — updated by message handlers, watched by views
export const artifacts = signal<ArtifactMeta[]>([]);
export const hooks = signal<Hook[]>([]);

// Derived state
export const activeAgent = computed(() =>
  agents.value.find(a => a.id === activeAgentId.value) ?? null
);

export const masterAgent = computed(() =>
  agents.value.find(a => a.master) ?? null
);

export const visibleAgents = computed(() =>
  agents.value.filter(a => a.role !== 'archived')
);

export const pinnedArtifacts = computed(() =>
  artifacts.value.filter(a => a.pinned)
);

export const recentArtifacts = computed(() =>
  artifacts.value
    .filter(a => !a.pinned)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
);

// Helper to refresh artifacts from the background
export async function refreshArtifacts(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const result = await sendMsg<{ artifacts: ArtifactMeta[] }>({ type: 'getArtifacts' });
    artifacts.value = result.artifacts || [];
  } catch { /* */ }
}

// Helper to refresh hooks from the background
export async function refreshHooks(): Promise<void> {
  const { sendMsg } = await import('../services/messaging.js');
  try {
    const result = await sendMsg<{ hooks: Hook[] }>({ type: 'getHooks' });
    hooks.value = result.hooks || [];
  } catch { /* */ }
}
