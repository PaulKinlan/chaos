/**
 * Agent Column — one vertical panel in the TUI.
 * Shows agent name, conversation history, streaming output, and input.
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Agent } from '@chaos/agent-loop';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface AgentColumnProps {
  agent: Agent;
  focused: boolean;
  onSubmit?: (agentId: string, message: string) => void;
}

export function AgentColumn({ agent, focused, onSubmit }: AgentColumnProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
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

    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev + ch);
    }
  });

  async function handleSubmit(message: string) {
    setBusy(true);
    setStreaming('');

    setMessages(prev => [...prev, { role: 'user', content: message }]);
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
            setStreaming(`[${currentTool}] ...`);
            break;
          case 'tool-result':
            setStreaming(`[${currentTool}] done`);
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

  const visibleMessages = messages.slice(-15);

  // Build the input display string with a block cursor
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
        <Text> </Text>
        <Text dimColor>
          {busy ? '(working...)' : ''}
        </Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i}>
            <Text
              color={msg.role === 'user' ? 'green' : msg.role === 'system' ? 'red' : 'white'}
              wrap="truncate-end"
            >
              {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : ''}
              {msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content}
            </Text>
          </Box>
        ))}

        {streaming && (
          <Box>
            <Text color="yellow" wrap="truncate-end">
              {streaming.length > 400 ? '...' + streaming.slice(-400) : streaming}
            </Text>
          </Box>
        )}
      </Box>

      {/* Input — single static Text to avoid layout bounce */}
      <Box borderTop borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color={focused ? 'cyan' : 'gray'}>
          {inputDisplay}
        </Text>
      </Box>
    </Box>
  );
}
