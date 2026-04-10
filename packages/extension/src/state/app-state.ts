import { signal, computed } from '@preact/signals-core';
import type { AgentMeta } from '../storage/types.js';

// Core application state as signals
export const activeView = signal<string>('chat');
export const activeAgentId = signal<string | null>(null);
export const agents = signal<AgentMeta[]>([]);
export const focusedColumnId = signal<string | null>(null);
export const debugMode = signal<boolean>(false);

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
