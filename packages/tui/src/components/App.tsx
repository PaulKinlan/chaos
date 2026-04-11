/**
 * Main App — TweetDeck-style multi-agent TUI.
 * Manages agent columns, keyboard navigation, and agent lifecycle.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { createAgent } from '@chaos/agent-loop';
import type { Agent, AgentConfig } from '@chaos/agent-loop';
import { AgentColumn } from './AgentColumn.js';
import { StatusBar } from './StatusBar.js';
import { createOsTools } from '../tools.js';

interface AppProps {
  model: AgentConfig['model'];
  provider: string;
  modelId: string;
  initialAgents?: Array<{ id: string; name: string; systemPrompt?: string }>;
}

const DEFAULT_SYSTEM = `You are a helpful coding assistant running in a terminal.
You have access to the local filesystem and can run shell commands.
The current working directory is: ${process.cwd()}
Be concise. Use tools to explore the codebase before answering questions about it.`;

export function App({ model, provider, modelId, initialAgents }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [termWidth, setTermWidth] = useState(stdout.columns || 120);
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [nameBuffer, setNameBuffer] = useState('');

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setTermWidth(stdout.columns || 120);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // Create initial agents on mount
  useEffect(() => {
    const specs = initialAgents && initialAgents.length > 0
      ? initialAgents
      : [{ id: 'assistant', name: 'Assistant' }];

    const created = specs.map((spec) => makeAgent(spec.id, spec.name, spec.systemPrompt));
    setAgents(created);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function makeAgent(id: string, name: string, systemPrompt?: string): Agent {
    const osTools = createOsTools();

    return createAgent({
      id,
      name,
      model,
      systemPrompt: systemPrompt || DEFAULT_SYSTEM,
      tools: { ...osTools },
      maxIterations: 20,
      permissions: {
        mode: 'accept-all',
      },
    });
  }

  // Global key handling (tab, ctrl+n, ctrl+d)
  useInput((ch, key) => {
    // Name input mode
    if (nameInput !== null) {
      if (key.return) {
        const name = nameBuffer.trim() || `Agent ${agents.length + 1}`;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const newAgent = makeAgent(id, name);
        setAgents(prev => [...prev, newAgent]);
        setActiveIdx(agents.length); // Focus new agent
        setNameInput(null);
        setNameBuffer('');
        return;
      }
      if (key.escape) {
        setNameInput(null);
        setNameBuffer('');
        return;
      }
      if (key.backspace || key.delete) {
        setNameBuffer(prev => prev.slice(0, -1));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setNameBuffer(prev => prev + ch);
        return;
      }
      return;
    }

    // Tab / Shift+Tab to switch columns
    if (key.tab) {
      if (key.shift) {
        setActiveIdx(prev => (prev - 1 + agents.length) % agents.length);
      } else {
        setActiveIdx(prev => (prev + 1) % agents.length);
      }
      return;
    }

    // Ctrl+N — new agent (enter name mode)
    if (ch === 'n' && key.ctrl) {
      setNameInput('');
      setNameBuffer('');
      return;
    }

    // Ctrl+D — delete focused agent
    if (ch === 'd' && key.ctrl) {
      if (agents.length <= 1) return; // Keep at least one
      const idxToRemove = activeIdx;
      agents[idxToRemove]?.abort();
      setAgents(prev => prev.filter((_, i) => i !== idxToRemove));
      setActiveIdx(prev => Math.min(prev, agents.length - 2));
      return;
    }
  });

  // Calculate column widths
  const colCount = agents.length;
  const colWidth = colCount > 0 ? Math.floor(termWidth / Math.min(colCount, 3)) : termWidth;
  // Show at most 3 columns, scrolling around active
  const maxVisible = 3;
  let startIdx = 0;
  if (colCount > maxVisible) {
    startIdx = Math.max(0, Math.min(activeIdx - 1, colCount - maxVisible));
  }
  const visibleAgents = agents.slice(startIdx, startIdx + maxVisible);

  return (
    <Box flexDirection="column" height={stdout.rows || 40}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">CHAOS TUI</Text>
        <Text dimColor>{process.cwd()}</Text>
      </Box>

      {/* Name input overlay */}
      {nameInput !== null && (
        <Box paddingX={1}>
          <Text color="yellow">New agent name: </Text>
          <Text>{nameBuffer}<Text backgroundColor="yellow"> </Text></Text>
          <Text dimColor> (Enter to create, Esc to cancel)</Text>
        </Box>
      )}

      {/* Agent columns */}
      <Box flexGrow={1} flexDirection="row">
        {visibleAgents.length === 0 ? (
          <Box justifyContent="center" alignItems="center" flexGrow={1}>
            <Text dimColor>No agents. Press Ctrl+N to create one.</Text>
          </Box>
        ) : (
          visibleAgents.map((agent, i) => (
            <AgentColumn
              key={agent.id}
              agent={agent}
              focused={startIdx + i === activeIdx}
              width={colWidth}
            />
          ))
        )}
      </Box>

      {/* Status bar */}
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
