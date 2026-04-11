/**
 * Agent Editor — view CLAUDE.md, memory files, conversations, and settings.
 * Escape to close.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import {
  readClaudeMd,
  listConversations,
  loadAgentRegistry,
  updateAgentMeta,
  type AgentMeta,
} from '../agent-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AgentEditorProps {
  agentId: string;
}

type Tab = 'claude' | 'memory' | 'conversations' | 'settings';

const PROVIDERS = ['anthropic', 'google', 'openai', 'ollama'];
const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5.4-mini'],
  ollama: ['llama3.2', 'mistral', 'codellama'],
};

export function AgentEditor({ agentId }: AgentEditorProps) {
  const { stdout } = useStdout();
  const [tab, setTab] = useState<Tab>('claude');
  const [claudeMd, setClaudeMd] = useState('');
  const [memoryFiles, setMemoryFiles] = useState<string[]>([]);
  const [memoryContent, setMemoryContent] = useState('');
  const [selectedMemory, setSelectedMemory] = useState(0);
  const [convos, setConvos] = useState<Array<{ id: string; timestamp: string; preview: string }>>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [meta, setMeta] = useState<AgentMeta | null>(null);
  const [settingsCursor, setSettingsCursor] = useState(0);

  const agentDir = path.resolve(process.cwd(), '.chaos', agentId);
  const maxLines = (stdout.rows || 40) - 8;

  useEffect(() => {
    setClaudeMd(readClaudeMd(agentId));

    const files: string[] = [];
    const memDir = path.join(agentDir, 'memories');
    if (fs.existsSync(memDir)) files.push(...fs.readdirSync(memDir).map(f => `memories/${f}`));
    for (const rootFile of ['TODO.md', 'activity-log.jsonl']) {
      if (fs.existsSync(path.join(agentDir, rootFile))) files.push(rootFile);
    }
    for (const subdir of ['people', 'ideas']) {
      const dir = path.join(agentDir, subdir);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) files.push(`${subdir}/${f}`);
      }
    }
    setMemoryFiles(files);
    setConvos(listConversations(agentId));

    const registry = loadAgentRegistry();
    setMeta(registry.find(a => a.id === agentId) || null);
  }, [agentId, agentDir]);

  useEffect(() => {
    if (tab === 'memory' && memoryFiles[selectedMemory]) {
      const filePath = path.join(agentDir, memoryFiles[selectedMemory]!);
      try { setMemoryContent(fs.readFileSync(filePath, 'utf-8')); }
      catch { setMemoryContent('(unable to read)'); }
    }
  }, [tab, selectedMemory, agentDir, memoryFiles]);

  useInput((ch, key) => {
    if (ch === '1') { setTab('claude'); setScrollOffset(0); return; }
    if (ch === '2') { setTab('memory'); setScrollOffset(0); return; }
    if (ch === '3') { setTab('conversations'); setScrollOffset(0); return; }
    if (ch === '4') { setTab('settings'); return; }

    if (tab === 'settings' && meta) {
      if (key.upArrow) { setSettingsCursor(prev => Math.max(0, prev - 1)); return; }
      if (key.downArrow) { setSettingsCursor(prev => Math.min(1, prev + 1)); return; }
      if (key.leftArrow || key.rightArrow) {
        if (settingsCursor === 0) {
          // Cycle provider
          const idx = PROVIDERS.indexOf(meta.provider || 'anthropic');
          const next = key.rightArrow
            ? PROVIDERS[(idx + 1) % PROVIDERS.length]!
            : PROVIDERS[(idx - 1 + PROVIDERS.length) % PROVIDERS.length]!;
          const updated = { ...meta, provider: next, model: MODELS[next]?.[0] || '' };
          updateAgentMeta(agentId, { provider: next, model: updated.model });
          setMeta(updated);
        } else if (settingsCursor === 1) {
          // Cycle model within current provider
          const provider = meta.provider || 'anthropic';
          const models = MODELS[provider] || [];
          const idx = models.indexOf(meta.model || '');
          const next = key.rightArrow
            ? models[(idx + 1) % models.length]!
            : models[(idx - 1 + models.length) % models.length]!;
          updateAgentMeta(agentId, { model: next });
          setMeta({ ...meta, model: next });
        }
        return;
      }
      return;
    }

    if (key.upArrow) {
      if (tab === 'memory') setSelectedMemory(prev => Math.max(0, prev - 1));
      else setScrollOffset(prev => Math.max(0, prev - 3));
      return;
    }
    if (key.downArrow) {
      if (tab === 'memory') setSelectedMemory(prev => Math.min(memoryFiles.length - 1, prev + 1));
      else setScrollOffset(prev => prev + 3);
      return;
    }
    if (key.pageUp) { setScrollOffset(prev => Math.max(0, prev - maxLines)); return; }
    if (key.pageDown) { setScrollOffset(prev => prev + maxLines); return; }
  });

  const tabItems: Array<{ key: string; label: string; id: Tab }> = [
    { key: '1', label: 'CLAUDE.md', id: 'claude' },
    { key: '2', label: 'Memory', id: 'memory' },
    { key: '3', label: 'History', id: 'conversations' },
    { key: '4', label: 'Settings', id: 'settings' },
  ];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={2}>
        <Text bold color="cyan">{agentId}</Text>
        {tabItems.map(t => (
          <Text key={t.id} color={tab === t.id ? 'cyan' : 'gray'} bold={tab === t.id}>
            [{t.key}] {t.label}
          </Text>
        ))}
        <Text dimColor>Esc to close</Text>
      </Box>

      {tab === 'claude' && (() => {
        const lines = claudeMd.split('\n');
        const visible = lines.slice(scrollOffset, scrollOffset + maxLines);
        return (
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="column" flexGrow={1}>
              {visible.map((line, i) => (
                <Text key={scrollOffset + i} wrap="truncate-end">
                  <Text dimColor>{String(scrollOffset + i + 1).padStart(3)} </Text>{line}
                </Text>
              ))}
            </Box>
            <Text dimColor>
              Lines {scrollOffset + 1}-{Math.min(scrollOffset + maxLines, lines.length)} of {lines.length} | Edit: .chaos/{agentId}/CLAUDE.md
            </Text>
          </Box>
        );
      })()}

      {tab === 'memory' && (
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" width={30} borderRight borderStyle="single" borderColor="gray"
            borderTop={false} borderBottom={false} borderLeft={false} paddingRight={1}>
            <Text bold>Files</Text>
            {memoryFiles.length === 0 ? <Text dimColor>(none yet)</Text> : (
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
                <Text key={i} wrap="wrap">{line}</Text>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {tab === 'conversations' && (
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Recent Conversations</Text>
          {convos.length === 0 ? <Text dimColor>(no conversations yet)</Text> : (
            convos.map(c => (
              <Box key={c.id} gap={1}>
                <Text dimColor>{c.timestamp.slice(0, 16)}</Text>
                <Text wrap="truncate-end">{c.preview}</Text>
              </Box>
            ))
          )}
        </Box>
      )}

      {tab === 'settings' && meta && (
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Agent Settings</Text>
          <Text dimColor>Use left/right arrows to change, up/down to select</Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={settingsCursor === 0 ? 'cyan' : 'white'}>
                {settingsCursor === 0 ? '> ' : '  '}Provider: </Text>
              <Text bold color="yellow">{meta.provider || '(default)'}</Text>
              <Text dimColor>  {'<-  ->'}</Text>
            </Box>
            <Box>
              <Text color={settingsCursor === 1 ? 'cyan' : 'white'}>
                {settingsCursor === 1 ? '> ' : '  '}Model:    </Text>
              <Text bold color="yellow">{meta.model || '(default)'}</Text>
              <Text dimColor>  {'<-  ->'}</Text>
            </Box>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Name: {meta.name}</Text>
            <Text dimColor>Role: {meta.role}</Text>
            <Text dimColor>Created: {meta.createdAt}</Text>
            <Text dimColor>ID: {meta.id}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Changes take effect when you close the editor (Esc). The agent will reload with the new model.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
