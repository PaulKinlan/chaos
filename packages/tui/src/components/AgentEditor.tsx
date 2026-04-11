/**
 * Agent Editor — view/edit CLAUDE.md, see memory files, and conversation history.
 * Opened with Ctrl+E, closed with Ctrl+E again.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  readClaudeMd,
  writeClaudeMd,
  listConversations,
} from '../agent-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AgentEditorProps {
  agentId: string;
}

type Tab = 'claude' | 'memory' | 'conversations';

export function AgentEditor({ agentId }: AgentEditorProps) {
  const [tab, setTab] = useState<Tab>('claude');
  const [claudeMd, setClaudeMd] = useState('');
  const [memoryFiles, setMemoryFiles] = useState<string[]>([]);
  const [memoryContent, setMemoryContent] = useState('');
  const [selectedMemory, setSelectedMemory] = useState(0);
  const [convos, setConvos] = useState<Array<{ id: string; timestamp: string; preview: string }>>([]);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    setClaudeMd(readClaudeMd(agentId));

    const memDir = path.resolve(process.cwd(), '.chaos', agentId, 'memories');
    if (fs.existsSync(memDir)) {
      setMemoryFiles(fs.readdirSync(memDir).filter(f => f.endsWith('.md')));
    }

    setConvos(listConversations(agentId));
  }, [agentId]);

  useEffect(() => {
    if (tab === 'memory' && memoryFiles[selectedMemory]) {
      const filePath = path.resolve(process.cwd(), '.chaos', agentId, 'memories', memoryFiles[selectedMemory]!);
      try {
        setMemoryContent(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        setMemoryContent('(unable to read)');
      }
    }
  }, [tab, selectedMemory, agentId, memoryFiles]);

  useInput((ch, key) => {
    // Tab switching: 1/2/3
    if (ch === '1') { setTab('claude'); setScrollOffset(0); return; }
    if (ch === '2') { setTab('memory'); setScrollOffset(0); return; }
    if (ch === '3') { setTab('conversations'); setScrollOffset(0); return; }

    // Scroll
    if (key.upArrow) {
      if (tab === 'memory') {
        setSelectedMemory(prev => Math.max(0, prev - 1));
      } else {
        setScrollOffset(prev => Math.max(0, prev - 3));
      }
      return;
    }
    if (key.downArrow) {
      if (tab === 'memory') {
        setSelectedMemory(prev => Math.min(memoryFiles.length - 1, prev + 1));
      } else {
        setScrollOffset(prev => prev + 3);
      }
      return;
    }
  });

  const tabLabels: Array<{ key: string; label: string; id: Tab }> = [
    { key: '1', label: 'CLAUDE.md', id: 'claude' },
    { key: '2', label: 'Memory', id: 'memory' },
    { key: '3', label: 'Conversations', id: 'conversations' },
  ];

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box gap={2} marginBottom={1}>
        <Text bold color="cyan">Edit: {agentId}</Text>
        {tabLabels.map(t => (
          <Text key={t.id} color={tab === t.id ? 'cyan' : 'gray'}>
            [{t.key}] {t.label}
          </Text>
        ))}
        <Text dimColor>Ctrl+E to close</Text>
      </Box>

      {/* Tab content */}
      {tab === 'claude' && (
        <Box flexDirection="column" flexGrow={1}>
          <Text dimColor>Agent instructions (edit with: chaos-tui edit {agentId})</Text>
          <Box marginTop={1}>
            <Text wrap="wrap">
              {claudeMd.split('\n').slice(scrollOffset, scrollOffset + 30).join('\n')}
            </Text>
          </Box>
          <Text dimColor>
            Lines {scrollOffset + 1}-{Math.min(scrollOffset + 30, claudeMd.split('\n').length)} of {claudeMd.split('\n').length} (arrows to scroll)
          </Text>
        </Box>
      )}

      {tab === 'memory' && (
        <Box flexDirection="row" flexGrow={1}>
          {/* File list */}
          <Box flexDirection="column" width={25} borderRight borderStyle="single" borderColor="gray" borderTop={false} borderBottom={false} borderLeft={false}>
            <Text bold>Memory Files</Text>
            {memoryFiles.length === 0 ? (
              <Text dimColor>(none yet)</Text>
            ) : (
              memoryFiles.map((f, i) => (
                <Text key={f} color={i === selectedMemory ? 'cyan' : 'white'}>
                  {i === selectedMemory ? '> ' : '  '}{f}
                </Text>
              ))
            )}
          </Box>
          {/* Content */}
          <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
            <Text bold>{memoryFiles[selectedMemory] || '(select a file)'}</Text>
            <Text wrap="wrap">{memoryContent}</Text>
          </Box>
        </Box>
      )}

      {tab === 'conversations' && (
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Recent Conversations</Text>
          {convos.length === 0 ? (
            <Text dimColor>(no conversations yet)</Text>
          ) : (
            convos.map(c => (
              <Box key={c.id}>
                <Text dimColor>{c.timestamp.slice(0, 16)} </Text>
                <Text>{c.preview}</Text>
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}
