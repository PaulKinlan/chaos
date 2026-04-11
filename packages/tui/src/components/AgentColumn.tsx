/**
 * Agent Column — one vertical panel in the TUI.
 * Shows agent name, conversation history, streaming output, and input.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent, ProgressEvent } from '@chaos/agent-loop';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface AgentColumnProps {
  agent: Agent;
  focused: boolean;
  width: number;
  onSubmit?: (agentId: string, message: string) => void;
}

export function AgentColumn({ agent, focused, width, onSubmit }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Handle keyboard input when focused
  useInput((ch, key) => {
    if (!focused) return;

    if (key.return && input.trim() && !busy) {
      const msg = input.trim();
      setInput('');
      setCursorPos(0);
      handleSubmit(msg);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(prev => prev - 1);
      }
      return;
    }

    if (key.escape) {
      if (busy && abortRef.current) {
        abortRef.current.abort();
      }
      return;
    }

    // Regular character input
    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos(prev => prev + 1);
    }
  });

  async function handleSubmit(message: string) {
    setBusy(true);
    setStreaming('');

    setMessages(prev => [...prev, {
      role: 'user',
      content: message,
      timestamp: new Date(),
    }]);

    onSubmit?.(agent.id, message);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      let fullText = '';
      let currentTool = '';

      for await (const event of agent.stream(message)) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'thinking':
            setStreaming('Thinking...');
            break;
          case 'tool-call':
            currentTool = event.toolName || '';
            setStreaming(`Using: ${currentTool}(${JSON.stringify(event.toolArgs).slice(0, 60)}...)`);
            break;
          case 'tool-result':
            setStreaming(`${currentTool} done`);
            break;
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
        timestamp: new Date(),
      }]);
      setStreaming('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('aborted')) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Error: ${errMsg}`,
          timestamp: new Date(),
        }]);
      }
      setStreaming('');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  // Truncate messages to fit visible area (keep last N)
  const visibleMessages = messages.slice(-20);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle={focused ? 'bold' : 'single'}
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color={focused ? 'cyan' : 'white'}>
          {agent.name}
        </Text>
        <Text dimColor>
          {busy ? 'working...' : 'idle'}
        </Text>
      </Box>

      <Box marginY={0}>
        <Text dimColor>{'─'.repeat(Math.max(width - 4, 10))}</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} marginBottom={0}>
            <Text
              color={msg.role === 'user' ? 'green' : msg.role === 'system' ? 'red' : 'white'}
              wrap="wrap"
            >
              {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : ''}
              {msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content}
            </Text>
          </Box>
        ))}

        {/* Streaming output */}
        {streaming && (
          <Box>
            <Text color="yellow" wrap="wrap">
              {streaming.length > 300 ? '...' + streaming.slice(-300) : streaming}
            </Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box marginTop={0}>
        <Text dimColor>{'─'.repeat(Math.max(width - 4, 10))}</Text>
      </Box>
      <Box>
        <Text color={focused ? 'cyan' : 'gray'}>
          {focused ? '> ' : '  '}
        </Text>
        <Text>
          {input || (focused ? '' : '(tab to focus)')}
          {focused && <Text backgroundColor="cyan"> </Text>}
        </Text>
      </Box>
    </Box>
  );
}
