/**
 * Main App — TweetDeck-style multi-agent TUI.
 *
 * Key concepts:
 * - Agents persist in .chaos/agents.json and survive restarts
 * - Columns are views into agents — multiple columns can use the same agent
 * - Ctrl+N creates a new agent (name + role picker)
 * - Ctrl+O opens a new column for the focused agent (new conversation)
 * - Ctrl+W closes the focused column (agent stays)
 * - Ctrl+D deletes the focused agent entirely
 * - Messages queue when the agent is busy
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import type { Agent, AgentConfig } from '@chaos/agent-loop';
import { AgentColumn } from './AgentColumn.js';
import { StatusBar } from './StatusBar.js';
import { AgentEditor } from './AgentEditor.js';
import {
  loadAgentRegistry,
  createAgentMeta,
  createAgentInstance,
  deleteAgentMeta,
  listRoles,
  type AgentMeta,
} from '../agent-manager.js';

interface AppProps {
  model: AgentConfig['model'];
  provider: string;
  modelId: string;
  initialAgents?: Array<{ id: string; name: string; role?: string }>;
}

interface Column {
  id: string;          // unique column ID
  agentId: string;     // which agent this column talks to
  agent: Agent;        // agent instance
  meta: AgentMeta;     // agent metadata
}

type InputMode =
  | { type: 'chat' }
  | { type: 'new-name'; buffer: string }
  | { type: 'new-role'; name: string; roleIdx: number }
  | { type: 'editor'; agentId: string };

let colCounter = 0;
function nextColId(): string {
  return `col-${++colCounter}`;
}

export function App({ model, provider, modelId, initialAgents }: AppProps) {
  const { stdout } = useStdout();
  const [agents, setAgents] = useState<Map<string, { meta: AgentMeta; agent: Agent }>>(new Map());
  const [columns, setColumns] = useState<Column[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mode, setMode] = useState<InputMode>({ type: 'chat' });

  const roles = listRoles();

  // Load agents and create one column per agent on startup
  useEffect(() => {
    let registry = loadAgentRegistry();

    if (initialAgents && initialAgents.length > 0) {
      for (const spec of initialAgents) {
        if (!registry.find(a => a.id === spec.id)) {
          createAgentMeta(spec.name, spec.role || 'master');
        }
      }
      registry = loadAgentRegistry();
    }

    if (registry.length === 0) {
      createAgentMeta('Assistant', 'master');
      registry = loadAgentRegistry();
    }

    const agentMap = new Map<string, { meta: AgentMeta; agent: Agent }>();
    const cols: Column[] = [];

    for (const meta of registry) {
      const agent = createAgentInstance(meta, model);
      agentMap.set(meta.id, { meta, agent });
      cols.push({ id: nextColId(), agentId: meta.id, agent, meta });
    }

    setAgents(agentMap);
    setColumns(cols);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addAgent(name: string, role: string): void {
    const meta = createAgentMeta(name, role);
    const agent = createAgentInstance(meta, model);
    setAgents(prev => new Map(prev).set(meta.id, { meta, agent }));
    setColumns(prev => [...prev, { id: nextColId(), agentId: meta.id, agent, meta }]);
    setActiveIdx(columns.length);
  }

  function openNewColumn(): void {
    // Open a new column for the currently focused agent
    const current = columns[activeIdx];
    if (!current) return;
    const entry = agents.get(current.agentId);
    if (!entry) return;

    // Create a fresh agent instance for a new conversation
    const newAgent = createAgentInstance(entry.meta, model);
    const newCol: Column = {
      id: nextColId(),
      agentId: current.agentId,
      agent: newAgent,
      meta: entry.meta,
    };

    // Insert after the current column
    setColumns(prev => {
      const next = [...prev];
      next.splice(activeIdx + 1, 0, newCol);
      return next;
    });
    setActiveIdx(activeIdx + 1);
  }

  function closeColumn(): void {
    if (columns.length <= 1) return;
    setColumns(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(prev => Math.min(prev, columns.length - 2));
  }

  function deleteAgent(): void {
    const current = columns[activeIdx];
    if (!current) return;

    // Close all columns for this agent
    current.agent.abort();
    deleteAgentMeta(current.agentId);
    setAgents(prev => {
      const next = new Map(prev);
      next.delete(current.agentId);
      return next;
    });
    setColumns(prev => {
      const filtered = prev.filter(c => c.agentId !== current.agentId);
      return filtered.length > 0 ? filtered : prev; // Keep at least one
    });
    setActiveIdx(prev => Math.min(prev, Math.max(columns.length - 2, 0)));
  }

  function reloadAgent(agentId: string): void {
    const entry = agents.get(agentId);
    if (!entry) return;
    const newAgent = createAgentInstance(entry.meta, model);
    setAgents(prev => new Map(prev).set(agentId, { meta: entry.meta, agent: newAgent }));
    // Update all columns using this agent
    setColumns(prev => prev.map(col =>
      col.agentId === agentId ? { ...col, agent: newAgent } : col
    ));
  }

  useInput((ch, key) => {
    if (mode.type === 'editor') {
      if (key.escape) {
        reloadAgent(mode.agentId);
        setMode({ type: 'chat' });
      }
      return;
    }

    if (mode.type === 'new-name') {
      if (key.return) {
        const name = mode.buffer.trim() || `Agent ${agents.size + 1}`;
        setMode({ type: 'new-role', name, roleIdx: 0 });
        return;
      }
      if (key.escape) { setMode({ type: 'chat' }); return; }
      if (key.backspace || key.delete) {
        setMode({ type: 'new-name', buffer: mode.buffer.slice(0, -1) });
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setMode({ type: 'new-name', buffer: mode.buffer + ch });
      }
      return;
    }

    if (mode.type === 'new-role') {
      if (key.return) {
        addAgent(mode.name, roles[mode.roleIdx]!);
        setMode({ type: 'chat' });
        return;
      }
      if (key.escape) { setMode({ type: 'chat' }); return; }
      if (key.upArrow) {
        setMode({ type: 'new-role', name: mode.name, roleIdx: (mode.roleIdx - 1 + roles.length) % roles.length });
        return;
      }
      if (key.downArrow || key.tab) {
        setMode({ type: 'new-role', name: mode.name, roleIdx: (mode.roleIdx + 1) % roles.length });
      }
      return;
    }

    // Chat mode
    if (key.tab) {
      setActiveIdx(prev => key.shift
        ? (prev - 1 + columns.length) % columns.length
        : (prev + 1) % columns.length
      );
      return;
    }
    if (ch === 'n' && key.ctrl) { setMode({ type: 'new-name', buffer: '' }); return; }
    if (ch === 'o' && key.ctrl) { openNewColumn(); return; }
    if (ch === 'w' && key.ctrl) { closeColumn(); return; }
    if (ch === 'e' && key.ctrl) {
      const current = columns[activeIdx];
      if (current) setMode({ type: 'editor', agentId: current.agentId });
      return;
    }
    if (ch === 'd' && key.ctrl) { deleteAgent(); return; }
  });

  // Visible columns (max 3)
  const maxVisible = 3;
  const colCount = columns.length;
  let startIdx = 0;
  if (colCount > maxVisible) {
    startIdx = Math.max(0, Math.min(activeIdx - 1, colCount - maxVisible));
  }
  const visibleColumns = columns.slice(startIdx, startIdx + maxVisible);

  return (
    <Box flexDirection="column" height={stdout.rows || 40}>
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">CHAOS TUI</Text>
        <Text dimColor>{process.cwd()}</Text>
      </Box>

      {mode.type === 'new-name' && (
        <Box paddingX={1}>
          <Text color="yellow">New agent name: </Text>
          <Text>{mode.buffer}{'\u2588'}</Text>
          <Text dimColor> (Enter for role, Esc cancel)</Text>
        </Box>
      )}

      {mode.type === 'new-role' && (
        <Box paddingX={1} flexDirection="column">
          <Text color="yellow">Select role for "{mode.name}":</Text>
          {roles.map((role, i) => (
            <Box key={role} paddingLeft={2}>
              <Text color={i === mode.roleIdx ? 'cyan' : 'white'}>
                {i === mode.roleIdx ? '> ' : '  '}{role}
              </Text>
            </Box>
          ))}
          <Text dimColor>  (arrows to select, Enter to create)</Text>
        </Box>
      )}

      {mode.type === 'editor' && (
        <Box flexGrow={1} paddingX={1}>
          <AgentEditor agentId={mode.agentId} />
        </Box>
      )}

      {mode.type !== 'editor' && (
        <Box flexGrow={1} flexDirection="row">
          {visibleColumns.length === 0 ? (
            <Box justifyContent="center" alignItems="center" flexGrow={1}>
              <Text dimColor>No columns. Press Ctrl+N to create an agent.</Text>
            </Box>
          ) : (
            visibleColumns.map((col, i) => (
              <AgentColumn
                key={col.id}
                agent={col.agent}
                agentId={col.agentId}
                columnId={col.id}
                focused={mode.type === 'chat' && startIdx + i === activeIdx}
                role={col.meta.role}
              />
            ))
          )}
        </Box>
      )}

      <StatusBar
        agentCount={agents.size}
        activeIndex={activeIdx}
        columnCount={colCount}
        provider={provider}
        model={modelId}
        cwd={process.cwd()}
      />
    </Box>
  );
}
