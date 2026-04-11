/**
 * Agent Column — one vertical panel in the TUI.
 * Shows agent name, conversation history, streaming tool calls, and input.
 * Saves conversations to .chaos/{agentId}/conversations/.
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent } from '@chaos/agent-loop';
import { saveConversation, type ConversationEntry, type ConversationMessage, type ConversationToolCall } from '../agent-manager.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface ToolCall {
  name: string;
  args: string;
  result?: string;
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
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
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

  function persistConversation(msgs: Message[], lastToolCalls?: ToolCall[]) {
    const convoMessages: ConversationMessage[] = [];
    for (const m of msgs) {
      if (m.role === 'user' || m.role === 'assistant') {
        const msg: ConversationMessage = { role: m.role, content: m.content, timestamp: m.timestamp };
        // Attach tool calls to the last assistant message
        if (m.role === 'assistant' && lastToolCalls && lastToolCalls.length > 0 && m === msgs[msgs.length - 1]) {
          msg.toolCalls = lastToolCalls.map(tc => ({
            name: tc.name,
            args: tc.args,
            result: tc.result,
          }));
        }
        convoMessages.push(msg);
      }
    }

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
    setToolCalls([]);

    const ts = new Date().toISOString();
    const newMessages = [...messages, { role: 'user' as const, content: message, timestamp: ts }];
    setMessages(newMessages);
    onSubmit?.(agentId, message);

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
            const name = event.toolName || '?';
            const argsStr = formatArgs(event.toolArgs);
            setToolCalls(prev => [...prev, { name, args: argsStr }]);
            setStreaming(`Using ${name}...`);
            break;
          }
          case 'tool-result': {
            const resultStr = formatResult(event.toolResult);
            setToolCalls(prev => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = { ...updated[updated.length - 1]!, result: resultStr };
              }
              return updated;
            });
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
      const updatedMessages = [...newMessages, {
        role: 'assistant' as const,
        content: fullText || '(no response)',
        timestamp: responseTs,
      }];
      setMessages(updatedMessages);
      setStreaming('');

      // Persist conversation with tool calls
      persistConversation(updatedMessages, toolCalls);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted')) {
        const errMessages = [...newMessages, {
          role: 'system' as const,
          content: `Error: ${errMsg}`,
          timestamp: new Date().toISOString(),
        }];
        setMessages(errMessages);
      }
      setStreaming('');
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
    >
      {/* Header */}
      <Box>
        <Text bold color={focused ? 'cyan' : 'white'}>{agent.name}</Text>
        {role && <Text dimColor> [{role}]</Text>}
        <Text> </Text>
        <Text dimColor>{busy ? '(working...)' : ''}</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            <Text
              color={msg.role === 'user' ? 'green' : msg.role === 'system' ? 'red' : 'white'}
              wrap="truncate-end"
            >
              {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : ''}
              {msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content}
            </Text>
          </Box>
        ))}

        {/* Tool calls */}
        {busy && toolCalls.length > 0 && (
          <Box flexDirection="column">
            <Box>
              <Text dimColor>
                {showTools ? '[-]' : '[+]'} {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''} (^T toggle)
              </Text>
            </Box>
            {showTools && toolCalls.map((tc, i) => (
              <Box key={i} flexDirection="column" marginLeft={1}>
                <Text color="magenta" wrap="truncate-end">
                  {tc.result !== undefined ? '\u2713' : '\u25b6'} {tc.name}({tc.args})
                </Text>
                {tc.result !== undefined && (
                  <Text dimColor wrap="truncate-end">
                    {'  \u2192 '}{tc.result.length > 120 ? tc.result.slice(0, 120) + '...' : tc.result}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Streaming text */}
        {streaming && !streaming.startsWith('Using ') && streaming !== 'Thinking...' && (
          <Box><Text color="yellow" wrap="truncate-end">
            {streaming.length > 400 ? '...' + streaming.slice(-400) : streaming}
          </Text></Box>
        )}
        {streaming === 'Thinking...' && (
          <Box><Text color="yellow">Thinking...</Text></Box>
        )}
      </Box>

      {/* Input */}
      <Box borderTop borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={focused ? 'cyan' : 'gray'}>{inputDisplay}</Text>
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
