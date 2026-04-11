/**
 * Agent Column — one conversation panel in the TUI.
 * Multiple columns can share the same agent (different conversations).
 * Supports message queuing — type while busy, messages execute in order.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent, ConversationMessage as AgentHistoryMessage } from '@chaos/agent-loop';
import { saveConversation, type ConversationEntry, type ConversationMessage, type ConversationToolCall } from '../agent-manager.js';

interface ToolCall {
  name: string;
  args: string;
  result?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

interface AgentColumnProps {
  agent: Agent;
  agentId: string;
  columnId: string;
  conversationId: string;
  focused: boolean;
  role?: string;
}

/** Strip control characters that break terminal rendering, keep printable text */
function clean(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars (keep \n \t \r)
    .replace(/\t/g, '  ') // tabs to spaces
    .replace(/\r\n/g, '\n') // normalize line endings
    .replace(/\r/g, '\n');
}

export function AgentColumn({ agent, agentId, columnId, conversationId, focused, role }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [queue, setQueue] = useState<string[]>([]);
  const [scrollBack, setScrollBack] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const convoIdRef = useRef<string>(conversationId);
  const processingRef = useRef(false);
  const historyRef = useRef<AgentHistoryMessage[]>([]);
  const startupDoneRef = useRef(false);

  // On first mount, run startup check (review TODO.md for pending items)
  useEffect(() => {
    if (!startupDoneRef.current) {
      startupDoneRef.current = true;
      setQueue(prev => [...prev,
        'Read my TODO.md file. If there are active tasks (unchecked items), briefly list them and ask if I want you to work on any. If TODO.md is empty or all tasks are done, just say "No pending tasks." Keep it very short.'
      ]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Process queue when not busy
  useEffect(() => {
    if (!busy && queue.length > 0 && !processingRef.current) {
      const next = queue[0]!;
      setQueue(prev => prev.slice(1));
      processMessage(next);
    }
  }, [busy, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((ch, key) => {
    if (!focused) return;

    // ── Always-available controls ──
    if (ch === 't' && key.ctrl) { setShowTools(prev => !prev); return; }
    if (key.escape) { if (busy && abortRef.current) abortRef.current.abort(); return; }
    if (key.pageUp || (key.upArrow && !input)) {
      setScrollBack(prev => Math.min(prev + (key.pageUp ? 10 : 3), Math.max(messages.length - 2, 0)));
      return;
    }
    if (key.pageDown || (key.downArrow && !input)) {
      setScrollBack(prev => Math.max(prev - (key.pageDown ? 10 : 3), 0));
      return;
    }

    // ── Input controls ──
    if (key.return && input.trim()) {
      const msg = input.trim();
      setInput('');
      if (busy) { setQueue(prev => [...prev, msg]); } else { processMessage(msg); }
      return;
    }
    if (key.backspace || key.delete) { setInput(prev => prev.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta) { setInput(prev => prev + ch); }
  });

  // Auto-scroll to bottom on new messages (only if at bottom)
  useEffect(() => {
    if (scrollBack <= 1) setScrollBack(0);
    else setScrollBack(prev => prev + 1);
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function persistConversation(msgs: Message[]) {
    const convoMessages: ConversationMessage[] = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const msg: ConversationMessage = { role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.timestamp };
        if (m.toolCalls && m.toolCalls.length > 0) msg.toolCalls = m.toolCalls;
        return msg;
      });
    const convo: ConversationEntry = {
      id: convoIdRef.current, agentId,
      timestamp: convoMessages[0]?.timestamp || new Date().toISOString(),
      messages: convoMessages,
    };
    if (convo.messages.length > 0) saveConversation(agentId, convo);
  }

  const processMessage = useCallback(async (message: string) => {
    processingRef.current = true;
    setBusy(true);
    setStreaming('');
    setActiveToolCalls([]);

    const ts = new Date().toISOString();
    const userMsg: Message = { role: 'user', content: message, timestamp: ts };
    setMessages(prev => [...prev, userMsg]);

    // Build conversation history for the agent (previous turns only)
    const history = [...historyRef.current];

    const callsForThisTurn: ToolCall[] = [];

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      let fullText = '';

      for await (const event of agent.stream(message, undefined, history)) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'thinking':
            setStreaming('Thinking...');
            break;
          case 'tool-call': {
            const name = clean(event.toolName || '?');
            const args = clean(formatArgs(event.toolArgs));
            callsForThisTurn.push({ name, args });
            setActiveToolCalls([...callsForThisTurn]);
            setStreaming(`[${name}]`);
            break;
          }
          case 'tool-result': {
            const resultStr = clean(formatResult(event.toolResult));
            if (callsForThisTurn.length > 0) {
              callsForThisTurn[callsForThisTurn.length - 1]!.result = resultStr;
              setActiveToolCalls([...callsForThisTurn]);
            }
            break;
          }
          case 'text':
            fullText += event.content;
            setStreaming(clean(fullText));
            break;
          case 'done':
            fullText = event.content || fullText;
            break;
          case 'error':
            fullText = `Error: ${event.content}`;
            break;
        }
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: clean(fullText || '(no response)'),
        timestamp: new Date().toISOString(),
        toolCalls: callsForThisTurn.length > 0 ? [...callsForThisTurn] : undefined,
      };

      // Update conversation history for future turns
      historyRef.current.push({ role: 'user', content: message });
      historyRef.current.push({ role: 'assistant', content: fullText || '(no response)' });

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
        persistConversation(updated);
        return updated;
      });
      setTokenCount(prev => prev + Math.ceil((message.length + fullText.length) / 4));
      setStreaming('');
      setActiveToolCalls([]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted')) {
        setMessages(prev => [...prev, { role: 'system', content: `Error: ${clean(errMsg)}`, timestamp: new Date().toISOString() }]);
      }
      setStreaming('');
      setActiveToolCalls([]);
    } finally {
      setBusy(false);
      processingRef.current = false;
      abortRef.current = null;
    }
  }, [agent, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxVisible = 15;
  const endIdx = messages.length - scrollBack;
  const startMsgIdx = Math.max(0, endIdx - maxVisible);
  const visibleMessages = messages.slice(startMsgIdx, endIdx);
  const inputDisplay = focused ? `> ${input}\u2588` : '  (tab to focus)';

  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0}
      borderStyle={focused ? 'bold' : 'single'} borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1} overflow="hidden">

      {/* Header */}
      <Box>
        <Text bold color={focused ? 'cyan' : 'white'}>{agent.name}</Text>
        {role && <Text dimColor> [{role}]</Text>}
        {busy && <Text color="yellow"> working</Text>}
        {queue.length > 0 && <Text color="magenta"> +{queue.length}q</Text>}
        {scrollBack > 0 && <Text dimColor> [{scrollBack}up]</Text>}
        {tokenCount > 0 && <Text dimColor> ~{tokenCount > 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : tokenCount}tok</Text>}
      </Box>

      {/* Messages — flexGrow fills available space, flexShrink allows compression, overflow clips */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            <Text color={msg.role === 'user' ? 'green' : msg.role === 'system' ? 'red' : 'white'} wrap="wrap">
              {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : ''}
              {msg.content.length > 1000 ? msg.content.slice(0, 1000) + '\n...(truncated, scroll up for full)' : msg.content}
            </Text>

            {/* Tool history on completed messages */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <Box flexDirection="column" marginLeft={1}>
                <Text dimColor>
                  {showTools ? '[-]' : '[+]'} {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''} (^T)
                </Text>
                {showTools && msg.toolCalls.map((tc, j) => (
                  <Box key={j} marginLeft={1}>
                    <Text wrap="truncate-end">
                      <Text color="magenta">{'* '}{tc.name}</Text>
                      <Text dimColor>({tc.args})</Text>
                      {tc.result ? <Text dimColor>{' -> '}{tc.result}</Text> : null}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}

        {/* Active tool calls during generation */}
        {busy && activeToolCalls.length > 0 && showTools && (
          <Box flexDirection="column" marginLeft={1}>
            {activeToolCalls.map((tc, i) => (
              <Box key={i} marginLeft={1}>
                <Text wrap="truncate-end">
                  <Text color="magenta">{tc.result !== undefined ? '* ' : '> '}{tc.name}</Text>
                  <Text dimColor>({tc.args})</Text>
                  {tc.result !== undefined ? <Text dimColor>{' -> '}{tc.result}</Text> : null}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {streaming && !streaming.startsWith('[') && streaming !== 'Thinking...' && (
          <Text color="yellow" wrap="wrap">{streaming.length > 500 ? '...' + streaming.slice(-500) : streaming}</Text>
        )}
        {streaming === 'Thinking...' && <Text color="yellow">Thinking...</Text>}
        {streaming && streaming.startsWith('[') && <Text dimColor>{streaming}</Text>}
      </Box>

      {/* Input — flexShrink=0 ensures it's ALWAYS visible at the bottom */}
      <Box flexShrink={0} borderTop borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={focused ? 'cyan' : 'gray'} wrap="truncate-end">{inputDisplay}</Text>
      </Box>
    </Box>
  );
}

/** Format tool args as single-line key=value. No newlines allowed. */
function formatArgs(args: unknown): string {
  if (!args) return '';
  try {
    if (typeof args === 'object') {
      const entries = Object.entries(args as Record<string, unknown>);
      const parts = entries.map(([k, v]) => {
        let val: string;
        if (typeof v === 'string') {
          // Collapse to single line, truncate
          const oneLine = v.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
          val = oneLine.length > 30 ? `"${oneLine.slice(0, 27)}..."` : `"${oneLine}"`;
        } else {
          val = String(v);
        }
        return `${k}=${val}`;
      });
      const result = parts.join(', ');
      return result.length > 80 ? result.slice(0, 77) + '...' : result;
    }
    const s = String(args).replace(/\n/g, ' ').trim();
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  } catch { return '(...)'; }
}

/** Format tool result as single line. No newlines allowed. */
function formatResult(result: unknown): string {
  if (result === undefined || result === null) return '(empty)';
  const str = typeof result === 'string' ? result : JSON.stringify(result, null, 0);
  // Collapse to single line
  const oneLine = str.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine;
}
