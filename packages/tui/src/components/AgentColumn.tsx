/**
 * Agent Column — one conversation panel in the TUI.
 * Multiple columns can share the same agent (different conversations).
 * Supports message queuing — type while busy, messages execute in order.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent } from '@chaos/agent-loop';
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

export function AgentColumn({ agent, agentId, columnId, conversationId, focused, role }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [queue, setQueue] = useState<string[]>([]);
  const [scrollBack, setScrollBack] = useState(0);
  const [tokenCount, setTokenCount] = useState(0); // rough token estimate
  const abortRef = useRef<AbortController | null>(null);
  const convoIdRef = useRef<string>(conversationId);
  const processingRef = useRef(false);

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

    if (key.return && input.trim()) {
      const msg = input.trim();
      setInput('');

      if (busy) {
        // Queue the message
        setQueue(prev => [...prev, msg]);
      } else {
        processMessage(msg);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    if (key.escape) {
      if (busy && abortRef.current) {
        abortRef.current.abort();
      }
      return;
    }

    if (ch === 't' && key.ctrl) {
      setShowTools(prev => !prev);
      return;
    }

    // Scroll: Page Up/Down always work, Up/Down when input is empty
    if (key.pageUp || (key.upArrow && !input)) {
      setScrollBack(prev => Math.min(prev + (key.pageUp ? 10 : 3), Math.max(messages.length - 2, 0)));
      return;
    }
    if (key.pageDown || (key.downArrow && !input)) {
      setScrollBack(prev => Math.max(prev - (key.pageDown ? 10 : 3), 0));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev + ch);
    }
  });

  // Auto-scroll to bottom on new messages (only if already at bottom)
  useEffect(() => {
    if (scrollBack === 0) {
      // Already at bottom, stay there
    } else {
      // User has scrolled up — don't force them back down,
      // but bump the scroll position to account for the new message
      setScrollBack(prev => prev + 1);
    }
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function persistConversation(msgs: Message[]) {
    const convoMessages: ConversationMessage[] = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const msg: ConversationMessage = { role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.timestamp };
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.toolCalls = m.toolCalls;
        }
        return msg;
      });

    const convo: ConversationEntry = {
      id: convoIdRef.current,
      agentId,
      timestamp: convoMessages[0]?.timestamp || new Date().toISOString(),
      messages: convoMessages,
    };
    if (convo.messages.length > 0) {
      saveConversation(agentId, convo);
    }
  }

  const processMessage = useCallback(async (message: string) => {
    processingRef.current = true;
    setBusy(true);
    setStreaming('');
    setActiveToolCalls([]);

    const ts = new Date().toISOString();
    const userMsg: Message = { role: 'user', content: message, timestamp: ts };

    setMessages(prev => {
      const updated = [...prev, userMsg];
      return updated;
    });

    const callsForThisTurn: ToolCall[] = [];

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      let fullText = '';

      for await (const event of agent.stream(message)) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'thinking':
            setStreaming('Thinking...');
            break;
          case 'tool-call': {
            const tc: ToolCall = { name: event.toolName || '?', args: formatArgs(event.toolArgs) };
            callsForThisTurn.push(tc);
            setActiveToolCalls([...callsForThisTurn]);
            setStreaming(`Using ${tc.name}...`);
            break;
          }
          case 'tool-result': {
            const resultStr = formatResult(event.toolResult);
            if (callsForThisTurn.length > 0) {
              callsForThisTurn[callsForThisTurn.length - 1]!.result = resultStr;
              setActiveToolCalls([...callsForThisTurn]);
            }
            break;
          }
          case 'text':
            fullText += event.content;
            setStreaming(fullText);
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
        content: fullText || '(no response)',
        timestamp: new Date().toISOString(),
        toolCalls: callsForThisTurn.length > 0 ? [...callsForThisTurn] : undefined,
      };

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
        persistConversation(updated);
        return updated;
      });
      // Rough token estimate: ~4 chars per token
      setTokenCount(prev => prev + Math.ceil((message.length + fullText.length) / 4));
      setStreaming('');
      setActiveToolCalls([]);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted')) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Error: ${errMsg}`,
          timestamp: new Date().toISOString(),
        }]);
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
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      borderStyle={focused ? 'bold' : 'single'}
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      overflow="hidden"
    >
      {/* Header */}
      <Box>
        <Text bold color={focused ? 'cyan' : 'white'}>{agent.name}</Text>
        {role && <Text dimColor> [{role}]</Text>}
        {busy && <Text color="yellow"> working</Text>}
        {queue.length > 0 && <Text color="magenta"> +{queue.length}q</Text>}
        {scrollBack > 0 && <Text dimColor> [{scrollBack}up]</Text>}
        {tokenCount > 0 && <Text dimColor> ~{tokenCount > 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : tokenCount}tok</Text>}
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            <Text
              color={msg.role === 'user' ? 'green' : msg.role === 'system' ? 'red' : 'white'}
              wrap="wrap"
            >
              {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : ''}
              {msg.content}
            </Text>

            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <Box flexDirection="column" marginLeft={1}>
                <Text dimColor>
                  {showTools ? '[-]' : '[+]'} {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''} (^T)
                </Text>
                {showTools && msg.toolCalls.map((tc, j) => (
                  <Box key={j} flexDirection="column" marginLeft={1}>
                    <Text color="magenta" wrap="wrap">
                      {'\u2713'} {tc.name}({tc.args})
                    </Text>
                    {tc.result && (
                      <Text dimColor wrap="wrap">
                        {'  \u2192 '}{tc.result.length > 200 ? tc.result.slice(0, 200) + '...' : tc.result}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}

        {/* Active tool calls */}
        {busy && activeToolCalls.length > 0 && (
          <Box flexDirection="column" marginLeft={1}>
            {activeToolCalls.map((tc, i) => (
              <Box key={i} flexDirection="column" marginLeft={1}>
                <Text color="magenta" wrap="wrap">
                  {tc.result !== undefined ? '\u2713' : '\u25b6'} {tc.name}({tc.args})
                </Text>
                {tc.result !== undefined && (
                  <Text dimColor wrap="wrap">
                    {'  \u2192 '}{tc.result.length > 200 ? tc.result.slice(0, 200) + '...' : tc.result}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {streaming && !streaming.startsWith('Using ') && streaming !== 'Thinking...' && (
          <Text color="yellow" wrap="wrap">
            {streaming.length > 500 ? '...' + streaming.slice(-500) : streaming}
          </Text>
        )}
        {streaming === 'Thinking...' && <Text color="yellow">Thinking...</Text>}
      </Box>

      {/* Input — always accepting input, shows queue status */}
      <Box borderTop borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={focused ? 'cyan' : 'gray'} wrap="wrap">{inputDisplay}</Text>
      </Box>
    </Box>
  );
}

function formatArgs(args: unknown): string {
  if (!args) return '';
  if (typeof args === 'string') return args.slice(0, 80);
  try {
    const str = JSON.stringify(args);
    return str.length > 80 ? str.slice(0, 77) + '...' : str;
  } catch { return String(args).slice(0, 80); }
}

function formatResult(result: unknown): string {
  if (result === undefined || result === null) return '(empty)';
  return typeof result === 'string' ? result : JSON.stringify(result);
}
