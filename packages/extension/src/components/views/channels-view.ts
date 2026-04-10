/**
 * `<chaos-channels-view>` — Channels management view.
 *
 * Connects external channels (webhooks, Discord, Telegram, Email, File System)
 * to agents via a relay server.
 *
 * Renders into Light DOM so existing app.html CSS applies.
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sendMsg, sendPortMessage } from '../../services/messaging.js';
import type { AgentMeta } from '../../storage/types.js';
import {
  getRelaySettings,
  setRelaySettings,
  clearRelaySettings,
  DEFAULT_RELAY_URL,
  type RelaySettings,
} from '../../channels/config.js';
import {
  registerWithRelay,
  registerChannel as relayRegisterChannel,
  registerTelegramChannel,
  registerDiscordChannel,
  registerEmailChannel as relayRegisterEmailChannel,
  listChannels as relayListChannels,
  updateChannel as relayUpdateChannel,
  removeChannel as relayRemoveChannel,
  type RelayConfig,
} from '../../channels/relay-client.js';

// ── Helpers ──

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const MAX_CHANNEL_LOG_LINES = 200;

// ── Types ──

interface ChannelInfo {
  id: string;
  type: string;
  agentId: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  name?: string;
  prompt?: string;
  direction?: string;
}

interface LocalChannelConfig {
  id: string;
  name: string;
  type: 'filesystem';
  direction: 'bidirectional';
  directoryName: string;
  createdAt: string;
}

const LOCAL_CHANNELS_KEY = 'chaos-local-channels';
const FS_CHANNEL_DB = 'chaos-fs-channels';
const FS_CHANNEL_STORE = 'handles';

// ── IndexedDB helpers ──

function openFsChannelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_CHANNEL_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FS_CHANNEL_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeFsChannelHandle(channelId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsChannelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_CHANNEL_STORE, 'readwrite');
    tx.objectStore(FS_CHANNEL_STORE).put(handle, channelId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function removeFsChannelHandle(channelId: string): Promise<void> {
  try {
    const db = await openFsChannelDb();
    return new Promise((resolve) => {
      const tx = db.transaction(FS_CHANNEL_STORE, 'readwrite');
      tx.objectStore(FS_CHANNEL_STORE).delete(channelId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

async function getLocalChannels(): Promise<LocalChannelConfig[]> {
  const result = await chrome.storage.local.get(LOCAL_CHANNELS_KEY);
  return (result[LOCAL_CHANNELS_KEY] as LocalChannelConfig[]) || [];
}

async function setLocalChannels(channels: LocalChannelConfig[]): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_CHANNELS_KEY]: channels });
}

function startFsChannelObservation(channelId: string, name: string, handle: FileSystemDirectoryHandle): void {
  if (typeof (globalThis as any).FileSystemObserver === 'undefined') {
    console.warn('[fs-channel] FileSystemObserver not available in this browser');
    return;
  }
  try {
    const observer = new (globalThis as any).FileSystemObserver(
      (records: Array<{ type: string; changedHandle?: { name: string } }>) => {
        for (const record of records) {
          const filePath = record.changedHandle?.name || name;
          console.log(`[fs-channel] Change detected: ${record.type} in ${filePath}`);
          chrome.runtime.sendMessage({
            type: 'fsChannelEvent',
            channelId,
            changeType: record.type,
            path: filePath,
            directory: name,
          });
        }
      },
    );
    observer.observe(handle, { recursive: true });
    console.log(`[fs-channel] Observing directory for channel ${channelId}: ${name}`);
  } catch (err) {
    console.error('[fs-channel] Failed to start observation:', err);
  }
}

@customElement('chaos-channels-view')
export class ChaosChannelsView extends LitElement {
  createRenderRoot() { return this; }

  @property({ type: Array }) agents: AgentMeta[] = [];

  @state() private _relayUrl = DEFAULT_RELAY_URL;
  @state() private _relayConnected = false;
  @state() private _relayStatus = '';
  @state() private _relayStatusColor = 'var(--text-secondary)';
  @state() private _relayUserId = '';
  @state() private _channels: ChannelInfo[] = [];
  @state() private _localChannels: LocalChannelConfig[] = [];
  @state() private _logLines: string[] = [];
  @state() private _showTypePicker = false;
  @state() private _activeSetup: 'none' | 'telegram' | 'discord' | 'email' = 'none';
  @state() private _telegramStatus = '';
  @state() private _telegramStatusColor = 'var(--text-secondary)';
  @state() private _discordStatus = '';
  @state() private _discordStatusColor = 'var(--text-secondary)';
  @state() private _emailStatus = '';
  @state() private _emailStatusColor = 'var(--text-secondary)';
  @state() private _isDefaultUrl = true;
  @state() private _relayConfig: RelayConfig | null = null;
  @state() private _relaySettings: RelaySettings | null = null;

  private _channelLogListener: ((message: any) => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    console.log('[chaos-channels-view] connected');
    this._channelLogListener = (message: any) => {
      if (message.type === 'channelLog' && typeof message.message === 'string') {
        this._addLog(message.message);
      }
    };
    chrome.runtime.onMessage.addListener(this._channelLogListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._channelLogListener) {
      chrome.runtime.onMessage.removeListener(this._channelLogListener);
      this._channelLogListener = null;
    }
  }

  private _addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${timestamp}] ${message}`;
    const newLines = [...this._logLines, line];
    if (newLines.length > MAX_CHANNEL_LOG_LINES) {
      this._logLines = newLines.slice(newLines.length - MAX_CHANNEL_LOG_LINES);
    } else {
      this._logLines = newLines;
    }
    // Scroll log after render
    this.updateComplete.then(() => {
      const el = this.querySelector('#channel-log-output') as HTMLElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async refresh(): Promise<void> {
    console.log('[chaos-channels-view] refresh');
    const settings = await getRelaySettings();
    this._relaySettings = settings;

    if (settings) {
      this._relayUrl = settings.serverUrl;
      this._relayConnected = true;
      this._relayStatus = 'Verifying connection...';
      this._relayStatusColor = 'var(--text-secondary)';
      this._relayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };

      chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: settings.pollIntervalMinutes || 1 });

      try {
        this._addLog('Verifying connection and loading channels...');
        const channels = await relayListChannels(this._relayConfig);
        this._channels = channels as ChannelInfo[];
        this._addLog(`Loaded ${channels.length} channel(s)`);
        this._relayUserId = settings.userId;
        this._relayStatus = `Connected as ${settings.userId.slice(0, 8)}...`;
        this._relayStatusColor = 'var(--success, #4caf50)';
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
          this._addLog('Session expired or server restarted. Re-registering...');
          try {
            const { userId, apiKey } = await registerWithRelay(settings.serverUrl);
            this._addLog(`Re-registered. New user ID: ${userId.slice(0, 8)}...`);
            const newSettings: RelaySettings = { ...settings, userId, apiKey };
            await setRelaySettings(newSettings);
            this._relaySettings = newSettings;
            chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: settings.pollIntervalMinutes || 1 });
            this._relayConfig = { serverUrl: settings.serverUrl, apiKey };
            const channels = await relayListChannels(this._relayConfig);
            this._channels = channels as ChannelInfo[];
            this._addLog(`Loaded ${channels.length} channel(s) after re-registration`);
            this._relayUserId = userId;
            this._relayStatus = `Connected as ${userId.slice(0, 8)}... (re-registered)`;
            this._relayStatusColor = 'var(--success, #4caf50)';
          } catch (reregErr) {
            const reregMsg = reregErr instanceof Error ? reregErr.message : String(reregErr);
            this._addLog(`Re-registration failed: ${reregMsg}`);
            this._relayStatus = 'Disconnected (server unreachable)';
            this._relayStatusColor = 'var(--danger, red)';
          }
        } else {
          console.error('Failed to load channels:', err);
          this._addLog(`Failed to load channels: ${errMsg}`);
          this._relayStatus = 'Connected (failed to load channels)';
          this._relayStatusColor = 'var(--warning, orange)';
        }
      }
    } else {
      this._relayConnected = false;
      this._relayStatus = '';
      this._channels = [];
      this._relayConfig = null;
    }
    this._updateUrlDefault();
    this._localChannels = await getLocalChannels();
  }

  private _updateUrlDefault(): void {
    const currentValue = this._relayUrl.trim().replace(/\/$/, '');
    const defaultValue = DEFAULT_RELAY_URL.replace(/\/$/, '');
    this._isDefaultUrl = currentValue === defaultValue || currentValue === '';
  }

  private async _connect(): Promise<void> {
    const serverUrl = this._relayUrl.trim().replace(/\/$/, '');
    if (!serverUrl) {
      this._relayStatus = 'Enter a server URL';
      this._relayStatusColor = 'var(--danger, red)';
      return;
    }
    this._relayStatus = 'Connecting...';
    this._relayStatusColor = 'var(--text-secondary)';
    this._addLog(`Connecting to relay server at ${serverUrl}...`);

    try {
      const healthResp = await fetch(`${serverUrl}/health`);
      if (!healthResp.ok) throw new Error('Server not reachable');
      this._addLog('Server health check passed');
      const { userId, apiKey } = await registerWithRelay(serverUrl);
      this._addLog(`Registration successful. User ID: ${userId.slice(0, 8)}...`);
      const settings: RelaySettings = {
        serverUrl,
        apiKey,
        userId,
        pollIntervalMinutes: 1,
        lastPollTimestamp: new Date().toISOString(),
      };
      await setRelaySettings(settings);
      chrome.runtime.sendMessage({ type: 'startChannelPolling', intervalMinutes: 1 });
      this._addLog('Polling started (interval: 1 minute)');
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Registration failed: ${errMsg}`);
      this._relayStatus = `Failed: ${errMsg}`;
      this._relayStatusColor = 'var(--danger, red)';
    }
  }

  private async _disconnect(): Promise<void> {
    this._addLog('Disconnecting from relay server...');
    await clearRelaySettings();
    chrome.runtime.sendMessage({ type: 'stopChannelPolling' });
    this._addLog('Disconnected');
    await this.refresh();
  }

  private async _addWebhook(): Promise<void> {
    if (!this._relayConfig) return;
    try {
      this._addLog('Adding webhook channel...');
      const result = await relayRegisterChannel(this._relayConfig, { type: 'webhook', agentId: '', enabled: true, metadata: {} });
      this._addLog(`Channel added: ${result.channel.id.slice(0, 8)}...`);
      this._showTypePicker = false;
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Failed to add webhook channel: ${errMsg}`);
    }
  }

  private async _validateTelegram(): Promise<void> {
    if (!this._relaySettings) return;
    const tokenInput = this.querySelector('#telegram-bot-token') as HTMLInputElement;
    const botToken = tokenInput?.value.trim();
    if (!botToken) {
      this._telegramStatus = 'Enter a bot token';
      this._telegramStatusColor = 'var(--danger, red)';
      return;
    }
    this._telegramStatus = 'Validating...';
    this._telegramStatusColor = 'var(--text-secondary)';
    this._addLog('Registering Telegram bot...');
    const config: RelayConfig = { serverUrl: this._relaySettings.serverUrl, apiKey: this._relaySettings.apiKey };
    try {
      const result = await registerTelegramChannel(config, botToken) as { channelId: string; botUsername: string; pairingCode?: string };
      this._addLog(`Telegram bot connected: @${result.botUsername}`);
      this._telegramStatus = `Connected as @${result.botUsername}`;
      this._telegramStatusColor = 'var(--success, #4caf50)';
      if (result.pairingCode) {
        this._addLog(`Pairing code: ${result.pairingCode} — send this to @${result.botUsername} in Telegram`);
        this._showPairingDialog(result.botUsername, result.pairingCode);
      }
      this._activeSetup = 'none';
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Telegram registration failed: ${errMsg}`);
      this._telegramStatus = `Failed: ${errMsg}`;
      this._telegramStatusColor = 'var(--danger, red)';
    }
  }

  private async _validateDiscord(): Promise<void> {
    if (!this._relaySettings) return;
    const tokenInput = this.querySelector('#discord-bot-token') as HTMLInputElement;
    const botToken = tokenInput?.value.trim();
    if (!botToken) {
      this._discordStatus = 'Enter a bot token';
      this._discordStatusColor = 'var(--danger, red)';
      return;
    }
    this._discordStatus = 'Validating...';
    this._discordStatusColor = 'var(--text-secondary)';
    this._addLog('Registering Discord bot...');
    const config: RelayConfig = { serverUrl: this._relaySettings.serverUrl, apiKey: this._relaySettings.apiKey };
    try {
      const result = await registerDiscordChannel(config, botToken);
      this._addLog(`Discord bot connected: @${result.botUsername}`);
      this._discordStatus = `Connected as @${result.botUsername}`;
      this._discordStatusColor = 'var(--success, #4caf50)';
      if (result.pairingCode) {
        this._addLog(`Pairing code: ${result.pairingCode} — send this to @${result.botUsername} in Discord`);
        this._showPairingDialog(result.botUsername, result.pairingCode);
      }
      this._activeSetup = 'none';
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Discord registration failed: ${errMsg}`);
      this._discordStatus = `Failed: ${errMsg}`;
      this._discordStatusColor = 'var(--danger, red)';
    }
  }

  private async _registerEmail(): Promise<void> {
    if (!this._relaySettings) return;
    const emailInput = this.querySelector('#email-user-address') as HTMLInputElement;
    const nameInput = this.querySelector('#email-channel-name') as HTMLInputElement;
    const userEmail = emailInput?.value.trim();
    const channelName = nameInput?.value.trim();
    if (!userEmail) {
      this._emailStatus = 'Enter your email address';
      this._emailStatusColor = 'var(--danger, red)';
      return;
    }
    if (!channelName) {
      this._emailStatus = 'Enter a channel name';
      this._emailStatusColor = 'var(--danger, red)';
      return;
    }
    this._emailStatus = 'Registering...';
    this._emailStatusColor = 'var(--text-secondary)';
    this._addLog('Registering email channel...');
    const config: RelayConfig = { serverUrl: this._relaySettings.serverUrl, apiKey: this._relaySettings.apiKey };
    try {
      const result = await relayRegisterEmailChannel(config, userEmail, channelName);
      this._addLog(`Email channel created: ${result.inboundAddress}`);
      this._emailStatus = '';
      this._activeSetup = 'none';
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Email registration failed: ${errMsg}`);
      this._emailStatus = `Failed: ${errMsg}`;
      this._emailStatusColor = 'var(--danger, red)';
    }
  }

  private async _addFilesystem(): Promise<void> {
    this._showTypePicker = false;
    this._activeSetup = 'none';
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      if (!handle) return;
      const channelId = crypto.randomUUID();
      const channel: LocalChannelConfig = {
        id: channelId,
        name: `File System: ${handle.name}`,
        type: 'filesystem',
        direction: 'bidirectional',
        directoryName: handle.name,
        createdAt: new Date().toISOString(),
      };
      await storeFsChannelHandle(channelId, handle);
      const existing = await getLocalChannels();
      existing.push(channel);
      await setLocalChannels(existing);
      startFsChannelObservation(channelId, handle.name, handle);
      this._addLog(`Added filesystem channel: ${handle.name}`);
      this._localChannels = await getLocalChannels();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[fs-channel] Directory picker failed:', err);
        this._addLog(`Failed to add filesystem channel: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async _removeChannel(channelId: string): Promise<void> {
    if (!this._relayConfig) return;
    try {
      this._addLog(`Removing channel ${channelId.slice(0, 8)}...`);
      await relayRemoveChannel(this._relayConfig, channelId);
      this._addLog('Channel removed');
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Failed to remove channel: ${errMsg}`);
    }
  }

  private async _removeLocalChannel(channelId: string): Promise<void> {
    const channels = await getLocalChannels();
    const updated = channels.filter((c) => c.id !== channelId);
    await setLocalChannels(updated);
    await removeFsChannelHandle(channelId);
    this._addLog(`Removed local filesystem channel ${channelId.slice(0, 8)}`);
    this._localChannels = await getLocalChannels();
  }

  private async _saveAllowlist(channelId: string): Promise<void> {
    if (!this._relayConfig) return;
    const input = this.querySelector(`.allowlist-input[data-channel-id="${channelId}"]`) as HTMLInputElement;
    if (!input) return;
    const values = input.value.split(',').map(s => s.trim()).filter(Boolean);
    const channel = this._channels.find(c => c.id === channelId);
    const metaKey = channel?.type === 'email' ? 'allowedSenders' : 'allowedUsers';
    try {
      this._addLog(`Updating allowlist for ${channelId.slice(0, 8)}... (${values.length} entries)`);
      await relayUpdateChannel(this._relayConfig, channelId, { metadata: { [metaKey]: values } });
      this._addLog('Allowlist updated');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Failed to update allowlist: ${errMsg}`);
    }
  }

  private async _saveChannelConfig(channelId: string): Promise<void> {
    if (!this._relayConfig) return;
    const nameInput = this.querySelector(`.channel-name-input[data-channel-id="${channelId}"]`) as HTMLInputElement;
    const promptInput = this.querySelector(`.channel-prompt-input[data-channel-id="${channelId}"]`) as HTMLTextAreaElement;
    const agentSelect = this.querySelector(`.channel-agent-select[data-channel-id="${channelId}"]`) as HTMLSelectElement;
    const updates: Record<string, unknown> = {};
    if (nameInput) updates.name = nameInput.value.trim();
    if (promptInput) updates.prompt = promptInput.value.trim();
    if (agentSelect) updates.agentId = agentSelect.value;
    try {
      this._addLog(`Updating channel ${channelId.slice(0, 8)}...`);
      await relayUpdateChannel(this._relayConfig, channelId, updates);
      this._addLog('Channel config updated');
      await this.refresh();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._addLog(`Failed to update channel: ${errMsg}`);
    }
  }

  private _showPairingDialog(botUsername: string, pairingCode: string): void {
    document.getElementById('pairing-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'pairing-dialog';
    dialog.style.cssText = 'background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:12px;padding:0;max-width:440px;width:90%;font-family:var(--font-sans);';
    dialog.innerHTML = `
      <div style="padding:24px;">
        <h2 style="font-size:var(--text-lg);margin-bottom:16px;">Pair with your bot</h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">1</div>
            <div>
              <div style="font-weight:500;font-size:var(--text-sm);">Open the messaging app</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">Search for <strong>@${escapeHtml(botUsername)}</strong></div>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">2</div>
            <div>
              <div style="font-weight:500;font-size:var(--text-sm);">Send the pairing code</div>
              <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                <code style="font-size:var(--text-lg);font-weight:600;background:var(--bg-base);padding:6px 12px;border-radius:6px;border:1px solid var(--border-default);letter-spacing:2px;">${escapeHtml(pairingCode)}</code>
                <button class="btn btn-ghost btn-xs" id="btn-copy-pairing-code">Copy</button>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="background:var(--bg-surface);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;font-size:var(--text-sm);color:var(--text-secondary);">3</div>
            <div>
              <div style="font-weight:500;font-size:var(--text-sm);">Wait for confirmation</div>
            </div>
          </div>
        </div>
        <div id="pairing-status" style="margin-top:16px;padding:8px 12px;border-radius:6px;background:var(--bg-surface);font-size:var(--text-xs);color:var(--text-secondary);display:flex;align-items:center;gap:8px;">
          <span class="spinner" style="width:14px;height:14px;border:2px solid var(--border-default);border-top-color:var(--text-primary);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></span>
          Waiting for you to send the code...
        </div>
        <div style="margin-top:16px;display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" id="btn-close-pairing-dialog">Done</button>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.querySelector('#btn-copy-pairing-code')!.addEventListener('click', () => {
      navigator.clipboard.writeText(pairingCode).then(() => {
        const btn = dialog.querySelector('#btn-copy-pairing-code')!;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });
    dialog.querySelector('#btn-close-pairing-dialog')!.addEventListener('click', () => { dialog.close(); });

    // Poll for pairing completion
    let pollCount = 0;
    const maxPolls = 60;
    const pairingPollInterval = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) { clearInterval(pairingPollInterval); return; }
      try {
        const settings = await getRelaySettings();
        if (!settings) return;
        const config: RelayConfig = { serverUrl: settings.serverUrl, apiKey: settings.apiKey };
        const channels = await relayListChannels(config);
        const ch = channels.find((c: any) => c.metadata?.['botUsername'] === botUsername);
        if (ch && !ch.metadata?.['pairingCode']) {
          clearInterval(pairingPollInterval);
          const statusEl = dialog.querySelector('#pairing-status');
          if (statusEl) {
            statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg> <span style="color:var(--success);font-weight:500;">Paired successfully!</span>';
          }
          this._addLog('Bot paired successfully');
          setTimeout(() => { dialog.close(); this.refresh(); }, 1500);
        }
      } catch { /* ignore */ }
    }, 5000);

    dialog.addEventListener('close', () => { clearInterval(pairingPollInterval); dialog.remove(); this.refresh(); });
  }

  render() {
    const serverUrl = this._relaySettings?.serverUrl || this._relayUrl;

    return html`
      <div class="view-padded">
        <div class="section-header">
          <h2>Channels</h2>
        </div>
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:16px;">Connect external channels (webhooks, Discord, Telegram) to your agents via a relay server.</p>

        <!-- Relay Connect -->
        <div style="margin-bottom:12px;">
          <div class="settings-field">
            <label>Relay Server URL ${this._isDefaultUrl ? html`<span style="font-size:var(--text-xs);color:var(--text-muted);">(default)</span>` : nothing}</label>
            <div style="display:flex;gap:var(--sp-1);align-items:center;">
              <input type="text" .value=${this._relayUrl}
                ?disabled=${this._relayConnected}
                @input=${(e: Event) => { this._relayUrl = (e.target as HTMLInputElement).value; this._updateUrlDefault(); }}
                placeholder="https://chaos-relay.com" style="flex:1;">
              ${!this._isDefaultUrl ? html`<button class="btn btn-ghost" style="font-size:var(--text-xs);white-space:nowrap;" @click=${() => { this._relayUrl = DEFAULT_RELAY_URL; this._updateUrlDefault(); }}>Reset to default</button>` : nothing}
            </div>
          </div>
          <div style="display:flex;gap:var(--sp-2);align-items:center;margin-top:8px;">
            <button class="btn btn-primary" @click=${this._connect}>Connect</button>
            ${this._relayConnected ? html`<button class="btn btn-ghost" @click=${this._disconnect}>Disconnect</button>` : nothing}
            <span style="font-size:var(--text-xs);color:${this._relayStatusColor};">${this._relayStatus}</span>
          </div>
        </div>

        <!-- Connected: channels -->
        ${this._relayConnected ? html`
          <div>
            <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:12px;">
              <button class="btn btn-ghost" @click=${() => { this._showTypePicker = !this._showTypePicker; this._activeSetup = 'none'; }}>+ Add Channel</button>
            </div>
            ${this._showTypePicker ? this._renderTypePicker() : nothing}
            ${this._activeSetup === 'telegram' ? this._renderTelegramSetup() : nothing}
            ${this._activeSetup === 'discord' ? this._renderDiscordSetup() : nothing}
            ${this._activeSetup === 'email' ? this._renderEmailSetup() : nothing}
            <div style="display:grid;gap:8px;">
              ${this._channels.map(ch => this._renderChannelCard(ch, serverUrl))}
              ${this._channels.length === 0 ? html`<p style="font-size:var(--text-xs);color:var(--text-muted);">No channels configured. Add a channel to get started.</p>` : nothing}
            </div>
          </div>
        ` : nothing}

        <!-- Local channels -->
        <div style="margin-top:12px;">
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:8px;">
            <span style="font-size:var(--text-xs);color:var(--text-secondary);">Local Channels</span>
            <button class="btn btn-ghost btn-sm" @click=${this._addFilesystem}>+ File System</button>
          </div>
          <div style="display:grid;gap:8px;">
            ${this._localChannels.map(ch => this._renderLocalChannelCard(ch))}
          </div>
        </div>

        <!-- Channel log -->
        <details style="margin-top:12px;">
          <summary style="cursor:pointer;font-size:var(--text-xs);color:var(--text-secondary);user-select:none;">Channel Logs</summary>
          <div style="margin-top:6px;position:relative;">
            <button class="btn btn-ghost" style="position:absolute;top:4px;right:4px;font-size:var(--text-xs);z-index:1;padding:2px 6px;" @click=${() => { this._logLines = []; }}>Clear</button>
            <pre id="channel-log-output" style="max-height:200px;overflow-y:auto;background:var(--bg-tertiary);color:var(--text-secondary);font-family:var(--font-mono);font-size:11px;padding:8px;border-radius:var(--radius-sm);margin:0;white-space:pre-wrap;word-break:break-all;">${this._logLines.join('\n')}</pre>
          </div>
        </details>
      </div>
    `;
  }

  private _renderTypePicker() {
    return html`
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:8px;">Choose channel type:</p>
        <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap;">
          <button class="btn btn-ghost" @click=${this._addWebhook}>Webhook</button>
          <button class="btn btn-ghost" @click=${() => { this._showTypePicker = false; this._activeSetup = 'telegram'; }}>Telegram Bot</button>
          <button class="btn btn-ghost" @click=${() => { this._showTypePicker = false; this._activeSetup = 'discord'; }}>Discord Bot</button>
          <button class="btn btn-ghost" @click=${() => { this._showTypePicker = false; this._activeSetup = 'email'; }}>Email</button>
          <button class="btn btn-ghost" @click=${this._addFilesystem}>File System</button>
        </div>
      </div>
    `;
  }

  private _renderTelegramSetup() {
    return html`
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:8px;">Enter your Telegram bot token (from @BotFather):</p>
        <div class="settings-field">
          <input type="password" id="telegram-bot-token" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" style="font-family:monospace;">
        </div>
        <div style="display:flex;gap:var(--sp-2);align-items:center;margin-top:8px;">
          <button class="btn btn-primary" @click=${this._validateTelegram}>Validate & Connect</button>
          <button class="btn btn-ghost" @click=${() => { this._activeSetup = 'none'; }}>Cancel</button>
          <span style="font-size:var(--text-xs);color:${this._telegramStatusColor};">${this._telegramStatus}</span>
        </div>
      </div>
    `;
  }

  private _renderDiscordSetup() {
    return html`
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:8px;">Enter your Discord bot token:</p>
        <div class="settings-field">
          <input type="password" id="discord-bot-token" placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.XXXXXX.XXXXXXXXXX" style="font-family:monospace;">
        </div>
        <div style="display:flex;gap:var(--sp-2);align-items:center;margin-top:8px;">
          <button class="btn btn-primary" @click=${this._validateDiscord}>Validate & Connect</button>
          <button class="btn btn-ghost" @click=${() => { this._activeSetup = 'none'; }}>Cancel</button>
          <span style="font-size:var(--text-xs);color:${this._discordStatusColor};">${this._discordStatus}</span>
        </div>
      </div>
    `;
  }

  private _renderEmailSetup() {
    return html`
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:8px;">Set up an email channel:</p>
        <div class="settings-field" style="margin-bottom:8px;">
          <label style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:2px;display:block;">Your email address</label>
          <input type="email" id="email-user-address" placeholder="you@example.com">
        </div>
        <div class="settings-field">
          <label style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:2px;display:block;">Channel name (becomes the inbound address prefix)</label>
          <input type="text" id="email-channel-name" placeholder="assistant">
        </div>
        <div style="display:flex;gap:var(--sp-2);align-items:center;margin-top:8px;">
          <button class="btn btn-primary" @click=${this._registerEmail}>Register</button>
          <button class="btn btn-ghost" @click=${() => { this._activeSetup = 'none'; }}>Cancel</button>
          <span style="font-size:var(--text-xs);color:${this._emailStatusColor};">${this._emailStatus}</span>
        </div>
      </div>
    `;
  }

  private _renderChannelCard(ch: ChannelInfo, serverUrl: string) {
    const chName = ch.name || '';
    const chPrompt = ch.prompt || '';
    const explicitDir = ch.direction;
    const isBidirectional = explicitDir === 'bidirectional' || (!explicitDir && ch.type !== 'webhook');
    const dirLabel = isBidirectional ? 'Two-way' : 'Inbound only';
    const agentName = this.agents.find((a) => a.id === ch.agentId)?.name || (this.agents.find((a) => a.master)?.name || 'default');

    const sortedAgents = [...this.agents].sort((a, b) => {
      if (a.master && !b.master) return -1;
      if (!a.master && b.master) return 1;
      return a.name.localeCompare(b.name);
    });

    return html`
      <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:var(--text-sm);">${escapeHtml(chName || ch.type)}: ${ch.id.slice(0, 8)}...</strong>
          <button class="btn btn-ghost" style="color:var(--danger, red);font-size:var(--text-xs);" @click=${() => this._removeChannel(ch.id)}>Remove</button>
        </div>
        ${this._renderChannelDetail(ch, serverUrl)}
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;font-size:var(--text-xs);">
          <div>
            <label style="color:var(--text-muted);">Name</label>
            <input type="text" class="channel-name-input" data-channel-id="${ch.id}" .value=${chName} placeholder="e.g. GitHub Webhooks" style="width:100%;padding:4px 6px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);">
          </div>
          ${!isBidirectional ? html`
            <div>
              <label style="color:var(--text-muted);">Agent Instructions</label>
              <p style="color:var(--text-muted);margin:2px 0 4px;">Tell the agent what to do when a message arrives on this channel.</p>
              <textarea class="channel-prompt-input" data-channel-id="${ch.id}" placeholder="e.g. This is a GitHub webhook..." style="width:100%;padding:6px 8px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);min-height:80px;resize:vertical;font-family:var(--font-sans);line-height:1.4;">${chPrompt}</textarea>
            </div>
          ` : nothing}
          <div>
            <label style="color:var(--text-muted);">Assign to Agent</label>
            <select class="channel-agent-select" data-channel-id="${ch.id}" style="width:100%;padding:4px 6px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);">
              ${sortedAgents.map(a => html`<option value="${a.id}" ?selected=${ch.agentId === a.id || (!ch.agentId && a.master)}>${a.name}${a.master ? ' (master)' : ''}</option>`)}
            </select>
          </div>
          <div style="display:flex;gap:6px;"><button class="btn btn-primary btn-xs" @click=${() => this._saveChannelConfig(ch.id)}>Save</button></div>
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">${dirLabel} | Agent: ${escapeHtml(agentName)} | ${ch.enabled ? 'Enabled' : 'Disabled'}</div>
      </div>
    `;
  }

  private _renderChannelDetail(ch: ChannelInfo, serverUrl: string) {
    if (ch.type === 'webhook') {
      const webhookUrl = `${serverUrl}/webhook/${ch.id}?token=${ch.metadata['webhookSecret'] || ''}`;
      return html`<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;word-break:break-all;"><code>${webhookUrl}</code></div>`;
    }

    if (ch.type === 'telegram') {
      const botUsername = ch.metadata['botUsername'] as string || 'unknown';
      const allowedUsers = (ch.metadata['allowedUsers'] as string[] || []).join(', ');
      const pendingCode = ch.metadata['pairingCode'] as string | undefined;
      return html`
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">Bot: @${botUsername}</div>
        ${pendingCode ? html`
          <div style="font-size:var(--text-xs);margin-top:4px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-focus);border-radius:4px;">
            <strong style="color:var(--text-primary);">Pairing required:</strong> Send <code style="background:var(--bg-base);padding:1px 4px;border-radius:2px;">${pendingCode}</code> to @${botUsername} in Telegram to authorize yourself.
          </div>
        ` : nothing}
        <details style="margin-top:6px;font-size:var(--text-xs);">
          <summary style="cursor:pointer;color:var(--text-secondary);user-select:none;">Allowed Users${allowedUsers ? ` (${(ch.metadata['allowedUsers'] as string[]).length})` : ''}</summary>
          <div style="margin-top:4px;">
            <p style="color:var(--text-muted);margin-bottom:4px;">Comma-separated Telegram user IDs.</p>
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="text" class="allowlist-input" data-channel-id="${ch.id}" .value=${allowedUsers} placeholder="e.g. 123456789, 987654321" style="flex:1;padding:4px 6px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
              <button class="btn btn-primary btn-xs" @click=${() => this._saveAllowlist(ch.id)}>Save</button>
            </div>
          </div>
        </details>
      `;
    }

    if (ch.type === 'email') {
      const inboundAddr = ch.metadata['inboundAddress'] as string || ch.metadata['fromAddress'] as string || '';
      const verified = ch.metadata['verified'] as boolean || false;
      const allowedSenders = (ch.metadata['allowedSenders'] as string[] || []).join(', ');
      return html`
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">
          ${inboundAddr ? html`Inbound: <a href="mailto:${inboundAddr}" target="_blank" rel="noopener" style="color:var(--accent-text);">${inboundAddr}</a>` : nothing}
          | ${verified ? html`<span style="color:var(--success);">Verified</span>` : html`<span style="color:var(--warning-text);">Not verified</span>`}
        </div>
        <details style="margin-top:6px;font-size:var(--text-xs);">
          <summary style="cursor:pointer;color:var(--text-secondary);user-select:none;">Allowed Senders${allowedSenders ? ` (${(ch.metadata['allowedSenders'] as string[]).length})` : ''}</summary>
          <div style="margin-top:4px;">
            <p style="color:var(--text-muted);margin-bottom:4px;">Comma-separated email addresses.</p>
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="text" class="allowlist-input" data-channel-id="${ch.id}" .value=${allowedSenders} placeholder="e.g. user@example.com" style="flex:1;padding:4px 6px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
              <button class="btn btn-primary btn-xs" @click=${() => this._saveAllowlist(ch.id)}>Save</button>
            </div>
          </div>
        </details>
      `;
    }

    if (ch.type === 'discord') {
      const botUsername = ch.metadata['botUsername'] as string || 'unknown';
      const pendingCode = ch.metadata['pairingCode'] as string | undefined;
      return html`
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">Bot: @${botUsername}</div>
        ${pendingCode ? html`
          <div style="font-size:var(--text-xs);margin-top:4px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-focus);border-radius:4px;">
            <strong style="color:var(--text-primary);">Pairing required:</strong> Send <code style="background:var(--bg-base);padding:1px 4px;border-radius:2px;">${pendingCode}</code> to @${botUsername} in Discord.
          </div>
        ` : nothing}
      `;
    }

    return nothing;
  }

  private _renderLocalChannelCard(ch: LocalChannelConfig) {
    return html`
      <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:var(--text-sm);">${escapeHtml(ch.name || 'File System')}: ${escapeHtml(ch.directoryName)}</strong>
          <button class="btn btn-ghost" style="color:var(--danger, red);font-size:var(--text-xs);" @click=${() => this._removeLocalChannel(ch.id)}>Remove</button>
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">Directory: <code>${escapeHtml(ch.directoryName)}</code></div>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px;">Local | Bidirectional | File System channel</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chaos-channels-view': ChaosChannelsView;
  }
}
