/**
 * Agent Column — one vertical panel in the TUI.
 * Shows agent name, conversation with tool call history, and input.
 */

import React, { useState, useRef } from 'react';
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
  focused: boolean;
  role?: string;
  onSubmit?: (agentId: string, message: string) => void;
}

export function AgentColumn({ agent, agentId, focused, role, onSubmit }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const convoIdRef = useRef<string>(`convo-${Date.now()}`);

  useInput((ch, key) => {
    if (!focused) return;

    if (key.return && input.trim() && !busy) {
      const msg = input.trim();
      setInput('');
      handleSubmit(msg);
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

    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev + ch);
    }
  });

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

  async function handleSubmit(message: string) {
    setBusy(true);
    setStreaming('');
    setActiveToolCalls([]);

    const ts = new Date().toISOString();
    const userMsg: Message = { role: 'user', content: message, timestamp: ts };
    setMessages(prev => [...prev, userMsg]);
    onSubmit?.(agentId, message);

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

      const responseTs = new Date().toISOString();
      const assistantMsg: Message = {
        role: 'assistant',
        content: fullText || '(no response)',
        timestamp: responseTs,
        toolCalls: callsForThisTurn.length > 0 ? [...callsForThisTurn] : undefined,
      };

      const updated = [...messages, userMsg, assistantMsg];
      setMessages(updated);
      setStreaming('');
      setActiveToolCalls([]);
      persistConversation(updated);

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
      abortRef.current = null;
    }
  }

  const visibleMessages = messages.slice(-10);
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
        <Text> </Text>
        <Text dimColor>{busy ? '(working...)' : ''}</Text>
      </Box>

      {/* Messages with inline tool history */}
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

            {/* Tool call history attached to assistant messages — toggleable with Ctrl+T */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <Box flexDirection="column" marginLeft={1}>
                <Text dimColor>
                  {showTools ? '[-]' : '[+]'} {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''} used
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

        {/* Active tool calls during generation */}
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

        {/* Streaming text */}
        {streaming && !streaming.startsWith('Using ') && streaming !== 'Thinking...' && (
          <Text color="yellow" wrap="wrap">
            {streaming.length > 500 ? '...' + streaming.slice(-500) : streaming}
          </Text>
        )}
        {streaming === 'Thinking...' && (
          <Text color="yellow">Thinking...</Text>
        )}
      </Box>

      {/* Input */}
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
