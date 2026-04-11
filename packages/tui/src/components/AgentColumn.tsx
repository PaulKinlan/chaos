/**
 * Agent Column — one vertical panel in the TUI.
 * Shows agent name, conversation history, streaming tool calls, and input.
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent, ProgressEvent } from '@chaos/agent-loop';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ToolCall {
  name: string;
  args: string;
  result?: string;
  expanded: boolean;
}

interface AgentColumnProps {
  agent: Agent;
  focused: boolean;
  role?: string;
  onSubmit?: (agentId: string, message: string) => void;
}

export function AgentColumn({ agent, focused, role, onSubmit }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

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

    // Ctrl+T toggles tool call visibility
    if (ch === 't' && key.ctrl) {
      setShowTools(prev => !prev);
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev + ch);
    }
  });

  async function handleSubmit(message: string) {
    setBusy(true);
    setStreaming('');
    setToolCalls([]);

    setMessages(prev => [...prev, { role: 'user', content: message }]);
    onSubmit?.(agent.id, message);

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
            setToolCalls(prev => [...prev, { name, args: argsStr, expanded: true }]);
            setStreaming(`Using ${name}...`);
            break;
          }
          case 'tool-result': {
            const resultStr = formatResult(event.toolResult);
            setToolCalls(prev => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1]!,
                  result: resultStr,
                };
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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullText || '(no response)',
      }]);
      setStreaming('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted')) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Error: ${errMsg}`,
        }]);
      }
      setStreaming('');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const visibleMessages = messages.slice(-10);
  const inputDisplay = focused
    ? `> ${input}\u2588`
    : '  (tab to focus)';

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
        <Text bold color={focused ? 'cyan' : 'white'}>
          {agent.name}
        </Text>
        {role && (
          <Text dimColor> [{role}]</Text>
        )}
        <Text> </Text>
        <Text dimColor>
          {busy ? '(working...)' : ''}
        </Text>
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

        {/* Active tool calls — always visible during generation */}
        {busy && toolCalls.length > 0 && (
          <Box flexDirection="column" marginTop={0}>
            <Box>
              <Text dimColor>
                {showTools ? '[-]' : '[+]'} {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''} (Ctrl+T toggle)
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
          <Box>
            <Text color="yellow" wrap="truncate-end">
              {streaming.length > 400 ? '...' + streaming.slice(-400) : streaming}
            </Text>
          </Box>
        )}

        {streaming === 'Thinking...' && (
          <Box>
            <Text color="yellow">Thinking...</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box borderTop borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={focused ? 'cyan' : 'gray'}>
          {inputDisplay}
        </Text>
      </Box>
    </Box>
  );
}

function formatArgs(args: unknown): string {
  if (!args) return '';
  if (typeof args === 'string') return args.slice(0, 80);
  try {
    const str = JSON.stringify(args);
    if (str.length > 80) return str.slice(0, 77) + '...';
    return str;
  } catch {
    return String(args).slice(0, 80);
  }
}

function formatResult(result: unknown): string {
  if (result === undefined || result === null) return '(empty)';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return str;
}
