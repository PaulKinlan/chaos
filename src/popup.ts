/**
 * Popup UI
 *
 * Minimal popup showing active agent info and a button to open the NTP dashboard.
 */

export {};

import type { AgentMeta } from './storage/types.js';

// ── DOM elements ──

const agentInfoDiv = document.getElementById('agent-info') as HTMLDivElement;
const btnOpenDashboard = document.getElementById('btn-open-dashboard') as HTMLButtonElement;

// ── Apply saved theme ──

chrome.storage.sync.get('chaos:settings').then((result) => {
  const settings = result['chaos:settings'] as { theme?: string } | undefined;
  const theme = settings?.theme ?? 'system';
  if (theme !== 'system') {
    document.documentElement.setAttribute('data-theme', theme);
  }
});

// ── Load agent info ──

async function loadAgentInfo(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'listAgents' }) as { agents?: AgentMeta[] };
    const agents = response?.agents ?? [];
    if (agents.length > 0) {
      agentInfoDiv.innerHTML = agents
        .map(
          (a) =>
            `<div class="agent-row"><span class="name">${escapeHtml(a.name)}</span><span class="role">${escapeHtml(a.role)}</span></div>`,
        )
        .join('');
    } else {
      agentInfoDiv.innerHTML = `<div class="none">No agents yet</div>`;
    }
  } catch {
    agentInfoDiv.innerHTML = `<div class="none">Could not load agents</div>`;
  }
}

// ── Open dashboard (NTP) ──

btnOpenDashboard.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'openDashboard' });
  window.close();
});

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadAgentInfo();
