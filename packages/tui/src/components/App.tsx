/**
 * Main App — TweetDeck-style multi-agent TUI.
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

type InputMode =
  | { type: 'chat' }
  | { type: 'new-name'; buffer: string }
  | { type: 'new-role'; name: string; roleIdx: number }
  | { type: 'editor'; agentId: string };

export function App({ model, provider, modelId, initialAgents }: AppProps) {
  const { stdout } = useStdout();
  const [agents, setAgents] = useState<Array<{ meta: AgentMeta; agent: Agent }>>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mode, setMode] = useState<InputMode>({ type: 'chat' });

  const roles = listRoles();

  useEffect(() => {
    let registry = loadAgentRegistry();

    if (initialAgents && initialAgents.length > 0) {
      for (const spec of initialAgents) {
        if (!registry.find(a => a.id === spec.id)) {
          createAgentMeta(spec.name, spec.role || 'assistant');
        }
      }
      registry = loadAgentRegistry();
    }

    if (registry.length === 0) {
      createAgentMeta('Assistant', 'master');
      registry = loadAgentRegistry();
    }

    const loaded = registry.map(meta => ({
      meta,
      agent: createAgentInstance(meta, model),
    }));
    setAgents(loaded);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addAgent(name: string, role: string): void {
    const meta = createAgentMeta(name, role);
    const agent = createAgentInstance(meta, model);
    setAgents(prev => [...prev, { meta, agent }]);
    setActiveIdx(agents.length);
  }

  function removeAgent(idx: number): void {
    if (agents.length <= 1) return;
    const entry = agents[idx];
    if (entry) {
      entry.agent.abort();
      deleteAgentMeta(entry.meta.id);
    }
    setAgents(prev => prev.filter((_, i) => i !== idx));
    setActiveIdx(prev => Math.min(prev, agents.length - 2));
  }

  function reloadAgent(agentId: string): void {
    setAgents(prev => prev.map(entry => {
      if (entry.meta.id === agentId) {
        entry.agent.abort();
        return { meta: entry.meta, agent: createAgentInstance(entry.meta, model) };
      }
      return entry;
    }));
  }

  useInput((ch, key) => {
    // Editor mode — Escape to close
    if (mode.type === 'editor') {
      if (key.escape) {
        reloadAgent(mode.agentId);
        setMode({ type: 'chat' });
      }
      return;
    }

    // New agent — name entry
    if (mode.type === 'new-name') {
      if (key.return) {
        const name = mode.buffer.trim() || `Agent ${agents.length + 1}`;
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

    // New agent — role selection
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

    // Chat mode keybindings
    if (key.tab) {
      setActiveIdx(prev => key.shift
        ? (prev - 1 + agents.length) % agents.length
        : (prev + 1) % agents.length
      );
      return;
    }
    if (ch === 'n' && key.ctrl) { setMode({ type: 'new-name', buffer: '' }); return; }
    if (ch === 'e' && key.ctrl) {
      const current = agents[activeIdx];
      if (current) setMode({ type: 'editor', agentId: current.meta.id });
      return;
    }
    if (ch === 'd' && key.ctrl) { removeAgent(activeIdx); return; }
  });

  const maxVisible = 3;
  const colCount = agents.length;
  let startIdx = 0;
  if (colCount > maxVisible) {
    startIdx = Math.max(0, Math.min(activeIdx - 1, colCount - maxVisible));
  }
  const visibleAgents = agents.slice(startIdx, startIdx + maxVisible);

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
          {visibleAgents.length === 0 ? (
            <Box justifyContent="center" alignItems="center" flexGrow={1}>
              <Text dimColor>No agents. Press Ctrl+N to create one.</Text>
            </Box>
          ) : (
            visibleAgents.map((entry, i) => (
              <AgentColumn
                key={entry.meta.id}
                agent={entry.agent}
                agentId={entry.meta.id}
                focused={mode.type === 'chat' && startIdx + i === activeIdx}
                role={entry.meta.role}
              />
            ))
          )}
        </Box>
      )}

      <StatusBar
        agentCount={colCount}
        activeIndex={activeIdx}
        provider={provider}
        model={modelId}
        cwd={process.cwd()}
      />
    </Box>
  );
}
