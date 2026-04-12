/**
 * TUI Hooks System — OS-level event triggers for agents.
 *
 * Equivalent to the Chrome extension's hooks (browser events → agent tasks),
 * but for OS-level events: filesystem changes, timers, git events, env changes, URLs.
 *
 * Supported trigger types:
 * - file-changed: specific file modified
 * - directory-changed: any change in a directory tree
 * - git-commit: new commits detected (watches .git/refs)
 * - git-branch-switch: branch changes (watches .git/HEAD)
 * - env-changed: .env file modified
 * - url-changed: URL content changes (polled)
 * - cron: time-based (interval in minutes)
 * - command-exit: runs after a shell command completes
 *
 * Platform-specific (detected at runtime):
 * - Linux: inotify via fs.watch, /proc monitoring possible
 * - macOS: FSEvents via fs.watch, launchd integration possible
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const BASE_DIR = path.resolve(process.cwd(), '.chaos');
const HOOKS_FILE = path.join(BASE_DIR, 'hooks.json');

// ── Types ──

import type { Hook, HookTrigger } from '@chaos/sdk';

export type { Hook, HookTrigger };

export type HookTriggerType =
  | 'file-changed'
  | 'directory-changed'
  | 'git-commit'
  | 'git-branch-switch'
  | 'env-changed'
  | 'url-changed'
  | 'cron'
  | 'command-exit';

// ── Persistence ──

function ensureDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

export function loadHooks(): Hook[] {
  ensureDir();
  if (!fs.existsSync(HOOKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf-8')); }
  catch { return []; }
}

export function saveHooks(hooks: Hook[]): void {
  ensureDir();
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooks, null, 2), 'utf-8');
}

export function addHook(hook: Omit<Hook, 'id' | 'createdAt' | 'triggerCount' | 'enabled'>): Hook {
  const newHook: Hook = {
    ...hook,
    id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    triggerCount: 0,
    enabled: true,
  };
  const all = loadHooks();
  all.push(newHook);
  saveHooks(all);
  return newHook;
}

export function removeHook(id: string): void {
  saveHooks(loadHooks().filter(h => h.id !== id));
}

export function updateHookTrigger(id: string): void {
  const all = loadHooks();
  const hook = all.find(h => h.id === id);
  if (hook) {
    hook.triggerCount++;
    hook.lastTriggeredAt = new Date().toISOString();
    saveHooks(all);
  }
}

// ── Hook Engine ──

type HookCallback = (hook: Hook, context: string) => void;

const watchers: Map<string, fs.FSWatcher> = new Map();
const pollers: Map<string, ReturnType<typeof setInterval>> = new Map();
const urlHashes: Map<string, string> = new Map();

/**
 * Start all enabled hooks. Calls onTrigger when a hook fires.
 */
export function startHooks(onTrigger: HookCallback): void {
  const hooks = loadHooks().filter(h => h.enabled);

  for (const hook of hooks) {
    try {
      startHook(hook, onTrigger);
    } catch (err) {
      console.warn(`[hooks] Failed to start hook ${hook.id} (${hook.trigger.type}):`, err);
    }
  }

  console.log(`[hooks] Started ${hooks.length} hooks`);
}

function startHook(hook: Hook, onTrigger: HookCallback): void {
  const { trigger } = hook;

  switch (trigger.type) {
    case 'file-changed': {
      if (!trigger.path) return;
      const fullPath = path.resolve(process.cwd(), trigger.path);
      if (!fs.existsSync(fullPath)) return;

      const watcher = fs.watch(fullPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          updateHookTrigger(hook.id);
          onTrigger(hook, `File changed: ${trigger.path}`);
        }
      });
      watchers.set(hook.id, watcher);
      break;
    }

    case 'directory-changed': {
      const dirPath = path.resolve(process.cwd(), trigger.path || '.');
      if (!fs.existsSync(dirPath)) return;

      const watcher = fs.watch(dirPath, { recursive: true, persistent: false }, (eventType, filename) => {
        if (!filename) return;
        // Apply glob filter if specified
        if (trigger.glob && !filename.match(globToRegex(trigger.glob))) return;
        // Debounce — don't fire more than once per 2 seconds
        const key = `${hook.id}-debounce`;
        if (pollers.has(key)) return;
        pollers.set(key, setTimeout(() => pollers.delete(key), 2000) as unknown as ReturnType<typeof setInterval>);

        updateHookTrigger(hook.id);
        onTrigger(hook, `Directory change: ${filename} (${eventType})`);
      });
      watchers.set(hook.id, watcher);
      break;
    }

    case 'git-commit': {
      const refsPath = path.resolve(process.cwd(), '.git/refs/heads');
      if (!fs.existsSync(refsPath)) return;

      const watcher = fs.watch(refsPath, { persistent: false }, () => {
        updateHookTrigger(hook.id);
        onTrigger(hook, 'New git commit detected');
      });
      watchers.set(hook.id, watcher);
      break;
    }

    case 'git-branch-switch': {
      const headPath = path.resolve(process.cwd(), '.git/HEAD');
      if (!fs.existsSync(headPath)) return;

      const watcher = fs.watch(headPath, { persistent: false }, () => {
        const branch = fs.readFileSync(headPath, 'utf-8').trim();
        updateHookTrigger(hook.id);
        onTrigger(hook, `Branch switched: ${branch}`);
      });
      watchers.set(hook.id, watcher);
      break;
    }

    case 'env-changed': {
      const envPath = path.resolve(process.cwd(), trigger.path || '.env');
      if (!fs.existsSync(envPath)) return;

      const watcher = fs.watch(envPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          updateHookTrigger(hook.id);
          onTrigger(hook, `Environment file changed: ${trigger.path || '.env'}`);
        }
      });
      watchers.set(hook.id, watcher);
      break;
    }

    case 'url-changed': {
      if (!trigger.url) return;
      const interval = (trigger.intervalMinutes || 5) * 60_000;

      // Initial hash
      fetchUrlHash(trigger.url).then(h => urlHashes.set(hook.id, h));

      const poller = setInterval(async () => {
        try {
          const newHash = await fetchUrlHash(trigger.url!);
          const oldHash = urlHashes.get(hook.id);
          if (oldHash && newHash !== oldHash) {
            urlHashes.set(hook.id, newHash);
            updateHookTrigger(hook.id);
            onTrigger(hook, `URL content changed: ${trigger.url}`);
          } else {
            urlHashes.set(hook.id, newHash);
          }
        } catch { /* skip failed polls */ }
      }, interval);
      pollers.set(hook.id, poller);
      break;
    }

    case 'cron': {
      const interval = (trigger.intervalMinutes || 60) * 60_000;
      const poller = setInterval(() => {
        updateHookTrigger(hook.id);
        onTrigger(hook, `Cron trigger (every ${trigger.intervalMinutes}min)`);
      }, interval);
      pollers.set(hook.id, poller);
      break;
    }

    case 'command-exit':
      // Command-exit hooks are triggered manually after a command runs
      // They're not started as watchers — the TUI checks them after shell execution
      break;
  }
}

/**
 * Stop all hooks and clean up watchers/pollers.
 */
export function stopHooks(): void {
  for (const watcher of watchers.values()) {
    try { watcher.close(); } catch { /* */ }
  }
  watchers.clear();

  for (const poller of pollers.values()) {
    clearInterval(poller);
  }
  pollers.clear();

  urlHashes.clear();
  console.log('[hooks] All hooks stopped');
}

/**
 * Start a single new hook (called when an agent creates one mid-session).
 */
export function startSingleHook(hook: Hook, onTrigger: HookCallback): void {
  startHook(hook, onTrigger);
}

// ── Helpers ──

async function fetchUrlHash(url: string): Promise<string> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await resp.text();
  return crypto.createHash('md5').update(text).digest('hex');
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

// ── Default Hook Suggestions ──

export function getDefaultHookSuggestions(): Array<{ description: string; trigger: HookTrigger; prompt: string }> {
  const suggestions = [
    {
      description: 'Watch src/ for changes, run lint check',
      trigger: { type: 'directory-changed' as const, path: 'src', glob: '*.ts' },
      prompt: 'A source file was changed. Run the linter and report any new issues. Be brief.',
    },
    {
      description: 'Watch package.json for dependency changes',
      trigger: { type: 'file-changed' as const, path: 'package.json' },
      prompt: 'package.json was modified. Check what changed (git diff package.json) and flag any security concerns.',
    },
    {
      description: 'Summarize each new git commit',
      trigger: { type: 'git-commit' as const },
      prompt: 'A new commit was made. Run git log -1 --stat and write a brief summary of what changed.',
    },
    {
      description: 'Detect branch switches',
      trigger: { type: 'git-branch-switch' as const },
      prompt: 'The git branch changed. Report the new branch name and any uncommitted changes (git status).',
    },
    {
      description: 'Watch .env for changes',
      trigger: { type: 'env-changed' as const, path: '.env' },
      prompt: 'The .env file was modified. Check that no secrets were accidentally added to git (git diff .env). Warn if .env is not in .gitignore.',
    },
    {
      description: 'Remind about uncommitted changes every 30 min',
      trigger: { type: 'cron' as const, intervalMinutes: 30 },
      prompt: 'Run git status. If there are uncommitted changes, briefly remind me what they are.',
    },
    {
      description: 'Watch TODO.md for updates',
      trigger: { type: 'file-changed' as const, path: 'TODO.md' },
      prompt: 'TODO.md was updated. Read it and briefly summarize what tasks are active.',
    },
  ];

  // Only include suggestions where the watched path exists
  return suggestions.filter(s => {
    if (s.trigger.path) {
      return fs.existsSync(path.resolve(process.cwd(), s.trigger.path));
    }
    if (s.trigger.type === 'git-commit' || s.trigger.type === 'git-branch-switch') {
      return fs.existsSync(path.resolve(process.cwd(), '.git'));
    }
    return true; // cron, url-changed always available
  });
}
