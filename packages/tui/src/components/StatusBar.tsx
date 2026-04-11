/**
 * Status Bar — bottom bar showing keybindings and agent count.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  agentCount: number;
  activeIndex: number;
  provider: string;
  model: string;
  cwd: string;
}

export function StatusBar({ agentCount, activeIndex, provider, model, cwd }: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box gap={2}>
        <Text dimColor>Tab: switch</Text>
        <Text dimColor>Ctrl+N: new</Text>
        <Text dimColor>Ctrl+D: del</Text>
        <Text dimColor>Ctrl+T: tools</Text>
        <Text dimColor>Esc: abort</Text>
        <Text dimColor>Ctrl+C: quit</Text>
      </Box>
      <Box gap={2}>
        <Text dimColor>{cwd}</Text>
        <Text color="cyan">{provider}/{model}</Text>
        <Text dimColor>
          [{activeIndex + 1}/{agentCount}]
        </Text>
      </Box>
    </Box>
  );
}
