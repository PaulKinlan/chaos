/**
 * Status Bar — bottom bar showing keybindings, agent/column count.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  agentCount: number;
  columnCount: number;
  activeIndex: number;
  provider: string;
  model: string;
  cwd: string;
}

export function StatusBar({ agentCount, columnCount, activeIndex, provider, model }: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        <Text dimColor>Tab:switch</Text>
        <Text dimColor>^N:agent</Text>
        <Text dimColor>^O:column</Text>
        <Text dimColor>^W:close</Text>
        <Text dimColor>^E:edit</Text>
        <Text dimColor>^J:channels</Text>
        <Text dimColor>^K:hooks</Text>
        <Text dimColor>^T:tools</Text>
        <Text dimColor>PgUp/Dn:scroll</Text>
        <Text dimColor>Esc:abort</Text>
      </Box>
      <Box gap={1}>
        <Text color="cyan">{provider}/{model}</Text>
        <Text dimColor>[{activeIndex + 1}/{columnCount}col {agentCount}agt]</Text>
      </Box>
    </Box>
  );
}
