/**
 * Popup UI
 *
 * Minimal popup showing active agent info, agent switcher,
 * and a button to open the side panel.
 */

import type { AgentMeta } from './storage/types.js';

// ── DOM elements ──

const agentInfoDiv = document.getElementById('agent-info') as HTMLDivElement;
const agentSelect = document.getElementById('popup-agent-select') as HTMLSelectElement;
const btnOpenSidepanel = document.getElementById('btn-open-sidepanel') as HTMLButtonElement;

// ── State ──

let agents: AgentMeta[] = [];
let activeAgentId: string | null = null;

// ── Port connection ──

const port = chrome.runtime.connect({ name: 'chaos-sidepanel' });

port.onMessage.addListener((msg: Record<string, unknown>) => {
  switch (msg.type) {
    case 'agentList':
      agents = msg.agents as AgentMeta[];
      populateSelect();
      updateAgentInfo();
      break;
  }
});

// Request agent list
port.postMessage({ type: 'listAgents' });

// ── UI ──

function populateSelect(): void {
  while (agentSelect.options.length > 1) {
    agentSelect.remove(1);
  }

  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = `${agent.name} (${agent.role})`;
    agentSelect.appendChild(opt);
  }

  if (activeAgentId) {
    agentSelect.value = activeAgentId;
  } else if (agents.length > 0) {
    activeAgentId = agents[0].id;
    agentSelect.value = agents[0].id;
  }
}

function updateAgentInfo(): void {
  const agent = agents.find((a) => a.id === activeAgentId);
  if (agent) {
    agentInfoDiv.innerHTML = `
      <div class="name">${escapeHtml(agent.name)}</div>
      <div class="role">${escapeHtml(agent.role)}</div>
    `;
  } else {
    agentInfoDiv.innerHTML = `<div class="none">No agent selected</div>`;
  }
}

agentSelect.addEventListener('change', () => {
  activeAgentId = agentSelect.value || null;
  updateAgentInfo();
});

// ── Open side panel ──

btnOpenSidepanel.addEventListener('click', async () => {
  // Open the side panel in the current window
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id != null) {
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    }
  } catch {
    // sidePanel.open may not be available in all contexts
  }
  // Close the popup
  window.close();
});

// ── Open dashboard ──

const btnOpenDashboard = document.getElementById('btn-open-dashboard') as HTMLButtonElement;

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
