/**
 * Agent Editor — view CLAUDE.md, memory files, and conversation history.
 * Escape to close.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { readClaudeMd, listConversations } from '../agent-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AgentEditorProps {
  agentId: string;
}

type Tab = 'claude' | 'memory' | 'conversations';

export function AgentEditor({ agentId }: AgentEditorProps) {
  const { stdout } = useStdout();
  const [tab, setTab] = useState<Tab>('claude');
  const [claudeMd, setClaudeMd] = useState('');
  const [memoryFiles, setMemoryFiles] = useState<string[]>([]);
  const [memoryContent, setMemoryContent] = useState('');
  const [selectedMemory, setSelectedMemory] = useState(0);
  const [convos, setConvos] = useState<Array<{ id: string; timestamp: string; preview: string }>>([]);
  const [scrollOffset, setScrollOffset] = useState(0);

  const agentDir = path.resolve(process.cwd(), '.chaos', agentId);
  const maxLines = (stdout.rows || 40) - 8; // Leave room for header, tabs, footer

  useEffect(() => {
    // Read CLAUDE.md
    setClaudeMd(readClaudeMd(agentId));

    // Read memory files — check both .chaos/{id}/memories/ and root-level files the agent may have created
    const memDir = path.join(agentDir, 'memories');
    const files: string[] = [];
    if (fs.existsSync(memDir)) {
      files.push(...fs.readdirSync(memDir).map(f => `memories/${f}`));
    }
    // Also check TODO.md and other root files
    for (const rootFile of ['TODO.md', 'activity-log.jsonl']) {
      if (fs.existsSync(path.join(agentDir, rootFile))) {
        files.push(rootFile);
      }
    }
    // Check people/ and ideas/
    for (const subdir of ['people', 'ideas']) {
      const dir = path.join(agentDir, subdir);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          files.push(`${subdir}/${f}`);
        }
      }
    }
    setMemoryFiles(files);

    // Read conversations
    setConvos(listConversations(agentId));
  }, [agentId, agentDir]);

  useEffect(() => {
    if (tab === 'memory' && memoryFiles[selectedMemory]) {
      const filePath = path.join(agentDir, memoryFiles[selectedMemory]!);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        setMemoryContent(content);
      } catch {
        setMemoryContent('(unable to read)');
      }
    }
  }, [tab, selectedMemory, agentDir, memoryFiles]);

  useInput((ch, key) => {
    // Tab switching
    if (ch === '1') { setTab('claude'); setScrollOffset(0); return; }
    if (ch === '2') { setTab('memory'); setScrollOffset(0); return; }
    if (ch === '3') { setTab('conversations'); setScrollOffset(0); return; }

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
    // Page up/down
    if (key.pageUp) { setScrollOffset(prev => Math.max(0, prev - maxLines)); return; }
    if (key.pageDown) { setScrollOffset(prev => prev + maxLines); return; }
  });

  const tabItems: Array<{ key: string; label: string; id: Tab }> = [
    { key: '1', label: 'CLAUDE.md', id: 'claude' },
    { key: '2', label: 'Memory', id: 'memory' },
    { key: '3', label: 'Conversations', id: 'conversations' },
  ];

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box gap={2}>
        <Text bold color="cyan">{agentId}</Text>
        {tabItems.map(t => (
          <Text key={t.id} color={tab === t.id ? 'cyan' : 'gray'} bold={tab === t.id}>
            [{t.key}] {t.label}
          </Text>
        ))}
        <Text dimColor>Esc to close</Text>
      </Box>

      {/* CLAUDE.md tab */}
      {tab === 'claude' && (() => {
        const lines = claudeMd.split('\n');
        const visible = lines.slice(scrollOffset, scrollOffset + maxLines);
        const totalLines = lines.length;
        return (
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="column" flexGrow={1}>
              {visible.map((line, i) => (
                <Text key={scrollOffset + i} wrap="truncate-end">
                  <Text dimColor>{String(scrollOffset + i + 1).padStart(3)} </Text>
                  {line}
                </Text>
              ))}
            </Box>
            <Text dimColor>
              Lines {scrollOffset + 1}-{Math.min(scrollOffset + maxLines, totalLines)} of {totalLines} | Arrows/PgUp/PgDn to scroll | Edit: .chaos/{agentId}/CLAUDE.md
            </Text>
          </Box>
        );
      })()}

      {/* Memory tab */}
      {tab === 'memory' && (
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" width={30} borderRight borderStyle="single" borderColor="gray" borderTop={false} borderBottom={false} borderLeft={false} paddingRight={1}>
            <Text bold>Files</Text>
            {memoryFiles.length === 0 ? (
              <Text dimColor>(none yet)</Text>
            ) : (
              memoryFiles.map((f, i) => (
                <Text key={f} color={i === selectedMemory ? 'cyan' : 'white'} wrap="truncate-end">
                  {i === selectedMemory ? '> ' : '  '}{f}
                </Text>
              ))
            )}
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
            <Text bold color="cyan">{memoryFiles[selectedMemory] || '(select a file)'}</Text>
            <Box flexDirection="column" flexGrow={1}>
              {memoryContent.split('\n').slice(0, maxLines).map((line, i) => (
                <Text key={i} wrap="truncate-end">{line}</Text>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {/* Conversations tab */}
      {tab === 'conversations' && (
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Recent Conversations</Text>
          {convos.length === 0 ? (
            <Text dimColor>(no conversations yet — chat with the agent to create one)</Text>
          ) : (
            convos.map(c => (
              <Box key={c.id} gap={1}>
                <Text dimColor>{c.timestamp.slice(0, 16)}</Text>
                <Text wrap="truncate-end">{c.preview}</Text>
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}
