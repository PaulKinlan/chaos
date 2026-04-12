/**
 * Channels Panel — configure relay connection and manage external channels.
 * Accessible via Ctrl+J.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  loadRelaySettings,
  saveRelaySettings,
  loadChannelConfigs,
  saveChannelConfigs,
  registerWithRelay,
  createChannelsSDK,
  getChannelsSDK,
  isWebSocketConnected,
  type RelaySettings,
  type ChannelConfig,
} from '../channels.js';

interface ChannelsPanelProps {
  defaultAgentId: string;
  onChannelMessage?: (agentId: string, prompt: string) => void;
}

type View = 'main' | 'connect' | 'add-webhook' | 'add-telegram';

export function ChannelsPanel({ defaultAgentId }: ChannelsPanelProps) {
  const [settings, setSettings] = useState<RelaySettings | null>(null);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [view, setView] = useState<View>('main');
  const [cursor, setCursor] = useState(0);
  const [inputBuffer, setInputBuffer] = useState('');
  const [inputStep, setInputStep] = useState(0);
  const [status, setStatus] = useState('');

  // Temp state for multi-step forms
  const [tempUrl, setTempUrl] = useState('');

  useEffect(() => {
    const s = loadRelaySettings();
    setSettings(s);
    if (s) {
      setChannels(loadChannelConfigs());
      setStatus(isWebSocketConnected() ? 'Connected (WebSocket)' : 'Connected (Polling)');
    }
  }, []);

  useInput((ch, key) => {
    // ── Main view ──
    if (view === 'main') {
      if (key.upArrow) { setCursor(prev => Math.max(0, prev - 1)); return; }
      if (key.downArrow) { setCursor(prev => Math.min(channels.length - 1, prev + 1)); return; }

      if (ch === 'c') {
        setView('connect');
        setInputStep(0);
        setInputBuffer(settings?.serverUrl || 'https://chaos-relay.deno.dev');
        return;
      }
      if (ch === 'w') { setView('add-webhook'); setInputStep(0); setInputBuffer(''); return; }
      if (ch === 't') { setView('add-telegram'); setInputStep(0); setInputBuffer(''); return; }
      if (ch === 'r' && settings) {
        (async () => {
          try {
            const sdk = getChannelsSDK() || createChannelsSDK(settings);
            const remote = await sdk.channels.list();
            saveChannelConfigs(remote);
            setChannels(remote);
            setStatus('Channels refreshed');
          } catch (err) {
            setStatus(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
        return;
      }
      if (ch === 'd' && channels[cursor]) {
        const ch2 = channels[cursor]!;
        (async () => {
          try {
            if (settings) {
              const sdk = getChannelsSDK() || createChannelsSDK(settings);
              await sdk.channels.remove(ch2.id);
            }
            const updated = channels.filter(c => c.id !== ch2.id);
            saveChannelConfigs(updated);
            setChannels(updated);
          } catch { /* */ }
        })();
        return;
      }
      return;
    }

    // ── Text input views ──
    if (key.escape) { setView('main'); return; }
    if (key.backspace) { setInputBuffer(prev => prev.slice(0, -1)); return; }

    if (view === 'connect') {
      if (key.return) {
        if (inputStep === 0) {
          // URL entered, register
          setTempUrl(inputBuffer.trim());
          setStatus('Registering...');
          (async () => {
            try {
              const url = inputBuffer.trim();
              const { userId, apiKey } = await registerWithRelay(url);
              const newSettings: RelaySettings = {
                serverUrl: url, apiKey, userId,
                pollIntervalMinutes: 1,
                lastPollTimestamp: new Date().toISOString(),
              };
              saveRelaySettings(newSettings);
              setSettings(newSettings);

              const sdk = createChannelsSDK(newSettings);
              const remote = await sdk.channels.list();
              saveChannelConfigs(remote);
              setChannels(remote);

              setStatus(`Connected as ${userId}`);
              setView('main');
            } catch (err) {
              setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
        }
        return;
      }
      if (ch && !key.ctrl && !key.meta) { setInputBuffer(prev => prev + ch); }
      return;
    }

    if (view === 'add-webhook') {
      if (key.return) {
        if (inputStep === 0) {
          // Name entered
          setTempUrl(inputBuffer.trim());
          setInputStep(1);
          setInputBuffer(defaultAgentId);
        } else {
          // Agent ID entered, create webhook
          if (!settings) { setStatus('Not connected'); setView('main'); return; }
          (async () => {
            try {
              const sdk = getChannelsSDK() || createChannelsSDK(settings);
              const channel = await sdk.channels.register({
                type: 'webhook', direction: 'inbound', name: tempUrl,
                agentId: inputBuffer.trim(), enabled: true, metadata: {},
              });
              const updated = [...channels, channel];
              saveChannelConfigs(updated);
              setChannels(updated);
              setStatus(`Webhook created: ${channel.id}`);
              setView('main');
            } catch (err) {
              setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
        }
        return;
      }
      if (ch && !key.ctrl && !key.meta) { setInputBuffer(prev => prev + ch); }
      return;
    }

    if (view === 'add-telegram') {
      if (key.return) {
        if (inputStep === 0) {
          // Bot token entered
          setTempUrl(inputBuffer.trim());
          setInputStep(1);
          setInputBuffer(defaultAgentId);
        } else {
          // Agent ID, register
          if (!settings) { setStatus('Not connected'); setView('main'); return; }
          (async () => {
            try {
              const sdk = getChannelsSDK() || createChannelsSDK(settings);
              const result = await sdk.channels.registerTelegram(tempUrl, inputBuffer.trim());
              const remote = await sdk.channels.list();
              saveChannelConfigs(remote);
              setChannels(remote);
              setStatus(`Telegram: @${result.botUsername}`);
              setView('main');
            } catch (err) {
              setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
        }
        return;
      }
      if (ch && !key.ctrl && !key.meta) { setInputBuffer(prev => prev + ch); }
      return;
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={2}>
        <Text bold color="cyan">Channels</Text>
        <Text dimColor>
          {settings ? `${settings.serverUrl} (${status})` : 'Not connected'}
        </Text>
        <Text dimColor>Esc:close</Text>
      </Box>

      {view === 'main' && (
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          <Box gap={2} marginBottom={1}>
            <Text dimColor>c:connect</Text>
            <Text dimColor>w:add webhook</Text>
            <Text dimColor>t:add telegram</Text>
            <Text dimColor>r:refresh</Text>
            <Text dimColor>d:delete</Text>
          </Box>

          {channels.length === 0 ? (
            <Text dimColor>No channels. Press 'c' to connect to relay, then 'w' or 't' to add channels.</Text>
          ) : (
            channels.map((ch, i) => (
              <Box key={ch.id}>
                <Text color={i === cursor ? 'cyan' : 'white'}>
                  {i === cursor ? '> ' : '  '}
                  [{ch.enabled ? 'ON' : 'OFF'}] {ch.name || ch.id}
                  <Text dimColor> — {ch.type} ({ch.direction}, agent: {ch.agentId})</Text>
                </Text>
              </Box>
            ))
          )}
        </Box>
      )}

      {view === 'connect' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Relay server URL:</Text>
          <Box><Text color="cyan">{inputBuffer}{'\u2588'}</Text></Box>
          <Text dimColor>Enter to connect, Esc to cancel</Text>
        </Box>
      )}

      {view === 'add-webhook' && (
        <Box flexDirection="column" marginTop={1}>
          {inputStep === 0 ? (
            <><Text>Webhook name:</Text><Box><Text color="cyan">{inputBuffer}{'\u2588'}</Text></Box></>
          ) : (
            <><Text>Agent ID to handle messages:</Text><Box><Text color="cyan">{inputBuffer}{'\u2588'}</Text></Box></>
          )}
          <Text dimColor>Enter to continue, Esc to cancel</Text>
        </Box>
      )}

      {view === 'add-telegram' && (
        <Box flexDirection="column" marginTop={1}>
          {inputStep === 0 ? (
            <><Text>Telegram Bot Token (from @BotFather):</Text><Box><Text color="cyan">{inputBuffer}{'\u2588'}</Text></Box></>
          ) : (
            <><Text>Agent ID to handle messages:</Text><Box><Text color="cyan">{inputBuffer}{'\u2588'}</Text></Box></>
          )}
          <Text dimColor>Enter to continue, Esc to cancel</Text>
        </Box>
      )}

      {status && (
        <Box marginTop={1}>
          <Text dimColor>{status}</Text>
        </Box>
      )}
    </Box>
  );
}
