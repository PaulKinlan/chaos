/**
 * First-run onboarding wizard.
 *
 * Shows a multi-step dialog when no API keys are configured,
 * guiding the user through provider selection and key entry.
 */

import type { ApiKeys } from '../storage/types.js';

export interface OnboardingResult {
  provider: string;
  keys: ApiKeys;
  ollamaUrl?: string;
}

type SendMsgFn = <T = unknown>(msg: Record<string, unknown>) => Promise<T>;

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    recommended: true,
    placeholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Get a key from Anthropic',
    isKey: true,
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    recommended: false,
    placeholder: 'AI...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyLabel: 'Get a key from Google AI Studio',
    isKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    recommended: false,
    placeholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'Get a key from OpenAI',
    isKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    recommended: false,
    placeholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    keyLabel: 'Get a key from OpenRouter',
    isKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (local, free)',
    recommended: false,
    placeholder: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.ai',
    keyLabel: 'Install from ollama.ai \u2014 no key needed',
    isKey: false,
  },
] as const;

// SVG icons
const ICON_ROCKET = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`;
const ICON_KEY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const ICON_SHIELD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ICON_EXTERNAL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const ICON_ARROW_RIGHT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
const ICON_ARROW_LEFT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const OPTIONAL_PERMISSIONS = [
  { id: 'scripting', label: 'Read page content', description: 'Let agents read and interact with web pages', needsHost: true, recommended: true },
  { id: 'tabs', label: 'Tab management', description: 'Open, close, and navigate browser tabs', needsHost: false, recommended: true },
  { id: 'bookmarks', label: 'Bookmarks', description: 'Search and manage your bookmarks', needsHost: false, recommended: false },
  { id: 'history', label: 'Browsing history', description: 'Search your browsing history', needsHost: false, recommended: false },
  { id: 'notifications', label: 'Notifications', description: 'Show desktop notifications', needsHost: false, recommended: false },
  { id: 'downloads', label: 'Downloads', description: 'Download files on your behalf', needsHost: false, recommended: false },
] as const;

/**
 * Show the onboarding wizard and return the result when complete.
 * Returns null if the user closes/cancels.
 */
export function showOnboarding(sendMsg: SendMsgFn): Promise<OnboardingResult | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'onboarding-dialog';
    dialog.innerHTML = `
      <div class="onboarding-content">
        <!-- Step 1: Welcome -->
        <div class="onboarding-step" data-step="1">
          <div class="onboarding-icon">${ICON_ROCKET}</div>
          <h1 class="onboarding-title">Welcome to CHAOS</h1>
          <p class="onboarding-subtitle">Chrome Agent OS</p>
          <p class="onboarding-desc">AI agents that live in your browser, learn about you, and act on your behalf.</p>
          <p class="onboarding-desc onboarding-desc-muted">Let's get you set up in 2 minutes.</p>
          <div class="onboarding-actions">
            <button class="btn btn-primary onboarding-btn-next" data-next="2">
              Get Started ${ICON_ARROW_RIGHT}
            </button>
          </div>
        </div>

        <!-- Step 2: Provider & API Key -->
        <div class="onboarding-step" data-step="2" style="display:none;">
          <div class="onboarding-icon">${ICON_KEY}</div>
          <h1 class="onboarding-title">Choose your AI provider</h1>
          <p class="onboarding-desc">Select a provider and enter your API key to get started.</p>

          <div class="onboarding-providers">
            ${PROVIDERS.map((p, i) => `
              <label class="onboarding-provider-row${p.recommended ? ' recommended' : ''}" data-provider="${p.id}">
                <input type="radio" name="onboarding-provider" value="${p.id}" ${i === 0 ? 'checked' : ''}>
                <span class="onboarding-provider-name">${p.name}</span>
                ${p.recommended ? '<span class="onboarding-badge">recommended</span>' : ''}
              </label>
            `).join('')}
          </div>

          <div class="onboarding-key-section">
            <label class="onboarding-key-label" id="onboarding-key-label">API Key</label>
            <input type="password" class="onboarding-key-input" id="onboarding-key-input" placeholder="${PROVIDERS[0].placeholder}" autocomplete="off">
            <div class="onboarding-key-help" id="onboarding-key-help">
              <a href="${PROVIDERS[0].keyUrl}" target="_blank" rel="noopener noreferrer">
                ${PROVIDERS[0].keyLabel} ${ICON_EXTERNAL}
              </a>
            </div>
          </div>

          <div class="onboarding-error" id="onboarding-error" style="display:none;"></div>

          <div class="onboarding-actions onboarding-actions-split">
            <button class="btn btn-ghost onboarding-btn-back" data-back="1">
              ${ICON_ARROW_LEFT} Back
            </button>
            <button class="btn btn-primary onboarding-btn-save" id="onboarding-btn-save">
              Save & Continue ${ICON_ARROW_RIGHT}
            </button>
          </div>
        </div>

        <!-- Step 3: Browser Permissions -->
        <div class="onboarding-step" data-step="3" style="display:none;">
          <div class="onboarding-icon">${ICON_SHIELD}</div>
          <h1 class="onboarding-title">Browser permissions</h1>
          <p class="onboarding-desc">Enable permissions so your agents can interact with the browser. You can change these later in Settings.</p>

          <div class="onboarding-permissions" id="onboarding-permissions">
            ${OPTIONAL_PERMISSIONS.map((p) => `
              <div class="onboarding-perm-row" data-perm="${p.id}" data-needs-host="${p.needsHost}">
                <div class="onboarding-perm-info">
                  <span class="onboarding-perm-label">${p.label}</span>
                  <span class="onboarding-perm-desc">${p.description}</span>
                </div>
                <button class="btn onboarding-perm-btn" data-perm="${p.id}" data-needs-host="${p.needsHost}">
                  Enable
                </button>
              </div>
            `).join('')}
          </div>

          <div class="onboarding-actions onboarding-actions-split">
            <button class="btn btn-ghost onboarding-btn-back" data-back="2">
              ${ICON_ARROW_LEFT} Back
            </button>
            <button class="btn btn-primary" id="onboarding-btn-finish">
              Finish Setup ${ICON_ARROW_RIGHT}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // State
    let selectedProvider: string = PROVIDERS[0].id;
    let savedKeys: ApiKeys = {};
    let savedOllamaUrl: string | undefined;

    // Navigation between steps
    dialog.querySelectorAll<HTMLButtonElement>('.onboarding-btn-next').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.next;
        if (!next) return;
        dialog.querySelectorAll<HTMLDivElement>('.onboarding-step').forEach((s) => {
          s.style.display = s.dataset.step === next ? '' : 'none';
        });
      });
    });

    dialog.querySelectorAll<HTMLButtonElement>('.onboarding-btn-back').forEach((btn) => {
      btn.addEventListener('click', () => {
        const back = btn.dataset.back;
        if (!back) return;
        dialog.querySelectorAll<HTMLDivElement>('.onboarding-step').forEach((s) => {
          s.style.display = s.dataset.step === back ? '' : 'none';
        });
      });
    });

    // Provider selection
    const keyInput = dialog.querySelector('#onboarding-key-input') as HTMLInputElement;
    const keyLabel = dialog.querySelector('#onboarding-key-label') as HTMLLabelElement;
    const keyHelp = dialog.querySelector('#onboarding-key-help') as HTMLDivElement;
    const errorEl = dialog.querySelector('#onboarding-error') as HTMLDivElement;

    dialog.querySelectorAll<HTMLInputElement>('input[name="onboarding-provider"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        selectedProvider = radio.value;
        const providerInfo = PROVIDERS.find((p) => p.id === selectedProvider)!;

        keyInput.value = '';
        keyInput.placeholder = providerInfo.placeholder;
        errorEl.style.display = 'none';

        if (providerInfo.isKey) {
          keyInput.type = 'password';
          keyLabel.textContent = 'API Key';
        } else {
          keyInput.type = 'text';
          keyLabel.textContent = 'Base URL';
        }

        keyHelp.innerHTML = `<a href="${providerInfo.keyUrl}" target="_blank" rel="noopener noreferrer">${providerInfo.keyLabel} ${ICON_EXTERNAL}</a>`;
      });
    });

    // Save & Continue
    const saveBtn = dialog.querySelector('#onboarding-btn-save') as HTMLButtonElement;
    saveBtn.addEventListener('click', async () => {
      const value = keyInput.value.trim();
      const providerInfo = PROVIDERS.find((p) => p.id === selectedProvider)!;

      // Validate: require input for key-based providers
      if (providerInfo.isKey && !value) {
        errorEl.textContent = 'Please enter your API key.';
        errorEl.style.display = 'block';
        keyInput.focus();
        return;
      }

      // Build keys object
      const keys: ApiKeys = {};
      if (providerInfo.isKey) {
        (keys as Record<string, string>)[selectedProvider] = value;
      } else {
        // Ollama: save the base URL
        keys.ollama = value || 'http://localhost:11434/v1';
      }

      // Save for use by finish handler
      savedKeys = keys;
      savedOllamaUrl = !providerInfo.isKey ? (value || 'http://localhost:11434/v1') : undefined;

      // Disable button while saving
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="onboarding-spinner"></span> Saving...`;
      errorEl.style.display = 'none';

      try {
        // Save API keys
        await sendMsg({ type: 'setApiKeys', keys });

        // Save active provider setting
        const settingsResult = await sendMsg<{ settings: { theme: string } }>({ type: 'getSettings' });
        const currentTheme = (settingsResult as { settings?: { theme?: string } })?.settings?.theme || 'system';
        await sendMsg({ type: 'setSettings', settings: { activeProvider: selectedProvider, theme: currentTheme } });

        // Go to step 3 (permissions) instead of finishing
        saveBtn.disabled = false;
        saveBtn.innerHTML = `Save & Continue ${ICON_ARROW_RIGHT}`;
        dialog.querySelectorAll<HTMLDivElement>('.onboarding-step').forEach((s) => {
          s.style.display = s.dataset.step === '3' ? '' : 'none';
        });

        // Check which permissions are already granted and update buttons
        await updatePermissionButtons(dialog);
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `Save & Continue ${ICON_ARROW_RIGHT}`;
        errorEl.textContent = `Failed to save: ${err instanceof Error ? err.message : String(err)}`;
        errorEl.style.display = 'block';
      }
    });

    // Permission enable buttons (each needs its own user gesture)
    dialog.querySelectorAll<HTMLButtonElement>('.onboarding-perm-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const permName = btn.dataset.perm! as chrome.runtime.ManifestPermissions;
        const needsHost = btn.dataset.needsHost === 'true';
        const request: chrome.permissions.Permissions = { permissions: [permName] };
        if (needsHost) request.origins = ['<all_urls>'];

        try {
          const granted = await chrome.permissions.request(request);
          if (granted) {
            btn.innerHTML = `${ICON_CHECK} Enabled`;
            btn.classList.add('onboarding-perm-granted');
            btn.disabled = true;
          } else {
            btn.textContent = 'Denied';
            btn.classList.add('onboarding-perm-denied');
            setTimeout(() => {
              btn.textContent = 'Enable';
              btn.classList.remove('onboarding-perm-denied');
            }, 2000);
          }
        } catch {
          btn.textContent = 'Error';
          btn.classList.add('onboarding-perm-denied');
          setTimeout(() => {
            btn.textContent = 'Enable';
            btn.classList.remove('onboarding-perm-denied');
          }, 2000);
        }
      });
    });

    // Finish button
    const finishBtn = dialog.querySelector('#onboarding-btn-finish') as HTMLButtonElement;
    finishBtn.addEventListener('click', async () => {
      // Mark onboarding complete
      await chrome.storage.local.set({ 'chaos:onboarding-completed': true });

      dialog.close();
      dialog.remove();

      resolve({
        provider: selectedProvider,
        keys: savedKeys,
        ollamaUrl: savedOllamaUrl,
      });
    });

    // Prevent closing via Escape (user must complete or we resolve null on close)
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
    });

    dialog.showModal();
  });
}

async function updatePermissionButtons(dialog: HTMLDialogElement): Promise<void> {
  for (const perm of OPTIONAL_PERMISSIONS) {
    const btn = dialog.querySelector<HTMLButtonElement>(`.onboarding-perm-btn[data-perm="${perm.id}"]`);
    if (!btn) continue;
    const request: chrome.permissions.Permissions = { permissions: [perm.id as chrome.runtime.ManifestPermissions] };
    if (perm.needsHost) request.origins = ['<all_urls>'];
    try {
      const granted = await chrome.permissions.contains(request);
      if (granted) {
        btn.innerHTML = `${ICON_CHECK} Enabled`;
        btn.classList.add('onboarding-perm-granted');
        btn.disabled = true;
      }
    } catch {
      // ignore check errors
    }
  }
}

/**
 * Reset onboarding so it triggers again on next load.
 */
export async function resetOnboarding(): Promise<void> {
  await chrome.storage.local.remove('chaos:onboarding-completed');
}
