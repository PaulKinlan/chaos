/**
 * Hooks Panel — view, create, enable/disable, and delete hooks.
 * Opened with Ctrl+H, closed with Escape.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  loadHooks,
  saveHooks,
  addHook,
  removeHook,
  getDefaultHookSuggestions,
  type Hook,
  type HookTriggerType,
} from '../hooks.js';

interface HooksPanelProps {
  defaultAgentId: string;
}

type View = 'list' | 'create' | 'suggestions';

const TRIGGER_TYPES: HookTriggerType[] = [
  'file-changed', 'directory-changed', 'git-commit', 'git-branch-switch',
  'env-changed', 'url-changed', 'cron',
];

export function HooksPanel({ defaultAgentId }: HooksPanelProps) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<View>('list');

  // Create form state
  const [createStep, setCreateStep] = useState(0); // 0=type, 1=path, 2=prompt, 3=description
  const [createType, setCreateType] = useState(0);
  const [createPath, setCreatePath] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createInterval, setCreateInterval] = useState('60');

  // Suggestions
  const [suggestions, setSuggestions] = useState<ReturnType<typeof getDefaultHookSuggestions>>([]);

  useEffect(() => {
    setHooks(loadHooks());
    setSuggestions(getDefaultHookSuggestions());
  }, []);

  useInput((ch, key) => {
    // ── List view ──
    if (view === 'list') {
      if (key.upArrow) { setCursor(prev => Math.max(0, prev - 1)); return; }
      if (key.downArrow) { setCursor(prev => Math.min(hooks.length - 1, prev + 1)); return; }

      // Toggle enable/disable
      if (ch === 'e' || key.return) {
        const hook = hooks[cursor];
        if (hook) {
          hook.enabled = !hook.enabled;
          saveHooks(hooks);
          setHooks([...hooks]);
        }
        return;
      }

      // Delete
      if (ch === 'd' || key.delete) {
        const hook = hooks[cursor];
        if (hook) {
          removeHook(hook.id);
          const updated = hooks.filter(h => h.id !== hook.id);
          setHooks(updated);
          setCursor(prev => Math.min(prev, updated.length - 1));
        }
        return;
      }

      // New hook
      if (ch === 'n') {
        setView('create');
        setCreateStep(0);
        setCreateType(0);
        setCreatePath('');
        setCreatePrompt('');
        setCreateDesc('');
        setCreateInterval('60');
        return;
      }

      // Suggestions
      if (ch === 's') {
        setView('suggestions');
        setCursor(0);
        return;
      }
      return;
    }

    // ── Suggestions view ──
    if (view === 'suggestions') {
      if (key.upArrow) { setCursor(prev => Math.max(0, prev - 1)); return; }
      if (key.downArrow) { setCursor(prev => Math.min(suggestions.length - 1, prev + 1)); return; }
      if (key.return) {
        const s = suggestions[cursor];
        if (s) {
          addHook({ agentId: defaultAgentId, trigger: s.trigger, prompt: s.prompt, description: s.description });
          setHooks(loadHooks());
          setView('list');
        }
        return;
      }
      if (key.escape) { setView('list'); return; }
      return;
    }

    // ── Create view ──
    if (view === 'create') {
      if (key.escape) { setView('list'); return; }

      if (createStep === 0) {
        // Select trigger type
        if (key.upArrow) { setCreateType(prev => Math.max(0, prev - 1)); return; }
        if (key.downArrow) { setCreateType(prev => Math.min(TRIGGER_TYPES.length - 1, prev + 1)); return; }
        if (key.return) { setCreateStep(1); return; }
        return;
      }

      if (createStep === 1) {
        // Enter path/url/interval
        if (key.return) { setCreateStep(2); return; }
        if (key.backspace) {
          const type = TRIGGER_TYPES[createType]!;
          if (type === 'cron' || type === 'url-changed') {
            setCreateInterval(prev => prev.slice(0, -1));
          } else {
            setCreatePath(prev => prev.slice(0, -1));
          }
          return;
        }
        if (ch && !key.ctrl && !key.meta) {
          const type = TRIGGER_TYPES[createType]!;
          if (type === 'cron') {
            setCreateInterval(prev => prev + ch);
          } else if (type === 'url-changed') {
            setCreatePath(prev => prev + ch); // reuse path for URL
          } else {
            setCreatePath(prev => prev + ch);
          }
        }
        return;
      }

      if (createStep === 2) {
        // Enter prompt
        if (key.return && createPrompt.trim()) { setCreateStep(3); return; }
        if (key.backspace) { setCreatePrompt(prev => prev.slice(0, -1)); return; }
        if (ch && !key.ctrl && !key.meta) { setCreatePrompt(prev => prev + ch); }
        return;
      }

      if (createStep === 3) {
        // Enter description
        if (key.return && createDesc.trim()) {
          const type = TRIGGER_TYPES[createType]!;
          let trigger: import('../hooks.js').HookTrigger;
          switch (type) {
            case 'file-changed': trigger = { type, path: createPath }; break;
            case 'directory-changed': trigger = { type, path: createPath || undefined }; break;
            case 'env-changed': trigger = { type, path: createPath || undefined }; break;
            case 'git-commit': trigger = { type }; break;
            case 'git-branch-switch': trigger = { type }; break;
            case 'url-changed': trigger = { type, url: createPath, intervalMinutes: parseInt(createInterval) || 5 }; break;
            case 'cron': trigger = { type, intervalMinutes: parseInt(createInterval) || 60 }; break;
            default: trigger = { type: 'cron', intervalMinutes: 60 };
          }
          addHook({
            agentId: defaultAgentId,
            trigger,
            prompt: createPrompt,
            description: createDesc,
          });
          setHooks(loadHooks());
          setView('list');
          return;
        }
        if (key.backspace) { setCreateDesc(prev => prev.slice(0, -1)); return; }
        if (ch && !key.ctrl && !key.meta) { setCreateDesc(prev => prev + ch); }
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={2}>
        <Text bold color="cyan">Hooks</Text>
        {view === 'list' && <Text dimColor>n:new  s:suggestions  e:toggle  d:delete  Esc:close</Text>}
        {view === 'create' && <Text dimColor>Creating hook... Esc:cancel</Text>}
        {view === 'suggestions' && <Text dimColor>Enter:add  Esc:back</Text>}
      </Box>

      {/* List view */}
      {view === 'list' && (
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          {hooks.length === 0 ? (
            <Box flexDirection="column">
              <Text dimColor>No hooks configured.</Text>
              <Text dimColor>Press 'n' to create one, or 's' for suggestions.</Text>
            </Box>
          ) : (
            hooks.map((h, i) => (
              <Box key={h.id}>
                <Text color={i === cursor ? 'cyan' : 'white'}>
                  {i === cursor ? '> ' : '  '}
                  <Text color={h.enabled ? 'green' : 'red'}>[{h.enabled ? 'ON' : 'OFF'}]</Text>
                  {' '}{h.description}
                  <Text dimColor> ({h.trigger.type}{'path' in h.trigger && h.trigger.path ? `: ${h.trigger.path}` : ''}, fired: {h.triggerCount}x)</Text>
                </Text>
              </Box>
            ))
          )}
        </Box>
      )}

      {/* Suggestions view */}
      {view === 'suggestions' && (
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          <Text bold>Suggested hooks for this project:</Text>
          {suggestions.length === 0 ? (
            <Text dimColor>No suggestions available for this project.</Text>
          ) : (
            suggestions.map((s, i) => (
              <Box key={i}>
                <Text color={i === cursor ? 'cyan' : 'white'}>
                  {i === cursor ? '> ' : '  '}{s.description}
                  <Text dimColor> ({s.trigger.type})</Text>
                </Text>
              </Box>
            ))
          )}
        </Box>
      )}

      {/* Create view */}
      {view === 'create' && (
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          {createStep === 0 && (
            <Box flexDirection="column">
              <Text bold>Select trigger type:</Text>
              {TRIGGER_TYPES.map((t, i) => (
                <Text key={t} color={i === createType ? 'cyan' : 'white'}>
                  {i === createType ? '> ' : '  '}{t}
                </Text>
              ))}
            </Box>
          )}
          {createStep === 1 && (
            <Box flexDirection="column">
              {['file-changed', 'directory-changed', 'env-changed'].includes(TRIGGER_TYPES[createType]!) && (
                <Box><Text>Path: </Text><Text color="cyan">{createPath}{'\u2588'}</Text></Box>
              )}
              {TRIGGER_TYPES[createType] === 'url-changed' && (
                <Box flexDirection="column">
                  <Box><Text>URL: </Text><Text color="cyan">{createPath}{'\u2588'}</Text></Box>
                  <Box><Text dimColor>Poll interval (min): {createInterval}</Text></Box>
                </Box>
              )}
              {TRIGGER_TYPES[createType] === 'cron' && (
                <Box><Text>Interval (minutes): </Text><Text color="cyan">{createInterval}{'\u2588'}</Text></Box>
              )}
              {['git-commit', 'git-branch-switch'].includes(TRIGGER_TYPES[createType]!) && (
                <Text dimColor>No additional config needed. Press Enter.</Text>
              )}
            </Box>
          )}
          {createStep === 2 && (
            <Box flexDirection="column">
              <Text>What should the agent do when triggered?</Text>
              <Box><Text>Prompt: </Text><Text color="cyan">{createPrompt}{'\u2588'}</Text></Box>
            </Box>
          )}
          {createStep === 3 && (
            <Box flexDirection="column">
              <Text>Short description:</Text>
              <Box><Text>Desc: </Text><Text color="cyan">{createDesc}{'\u2588'}</Text></Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
