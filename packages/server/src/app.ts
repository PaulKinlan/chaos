// Per-user admin web app, served at /app and authenticated by a device-link
// token the CLI mints (no accounts, no passwords). The token is redeemed once in
// the browser for a short-lived app session, which then authorises read/manage
// operations scoped strictly to that one user's channels.
//
// Flow:
//   1. CLI (already holding the user's ECDSA key) calls POST /app/device-link
//      with its normal signed auth -> gets a one-time token + a /app URL.
//   2. User opens the URL; the page redeems ?token= via POST /app/api/session
//      for an app-session bearer (stored in sessionStorage).
//   3. /app/api/channels* operate on the app-session's userId only.

import { getChannels, removeChannel, updateChannelFields } from "./auth.ts";
import { getKvAsync } from "./kv.ts";
import { logger } from "./logger.ts";
import type { ChannelConfig } from "@chaos/shared";

const DEVICE_LINK_TTL_MS = 5 * 60 * 1000; // 5 minutes to redeem
const APP_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h browser session

// ── Device-link + app-session (all in Deno KV, expiring) ──

/** Mint a one-time device-link token bound to userId. Returns null if KV down. */
export async function mintDeviceLink(
  userId: string,
  baseUrl: string,
): Promise<{ token: string; url: string; expiresInSeconds: number } | null> {
  const kv = await getKvAsync();
  if (!kv) return null;
  const token = crypto.randomUUID();
  await kv.set(["device_link", token], { userId }, {
    expireIn: DEVICE_LINK_TTL_MS,
  });
  logger.info("app", "Device link minted", { userId });
  return {
    token,
    url: `${baseUrl}/app?token=${token}`,
    expiresInSeconds: DEVICE_LINK_TTL_MS / 1000,
  };
}

/** Redeem a device-link token (single use) for an app-session bearer token. */
export async function redeemDeviceLink(
  token: string,
): Promise<string | null> {
  const kv = await getKvAsync();
  if (!kv) return null;
  const dl = await kv.get<{ userId: string }>(["device_link", token]);
  if (!dl.value) return null;
  // Single use: atomically delete the device link and create the session so a
  // token cannot be redeemed twice.
  const sessionToken = crypto.randomUUID();
  const res = await kv.atomic()
    .check(dl)
    .delete(["device_link", token])
    .set(["app_session", sessionToken], { userId: dl.value.userId }, {
      expireIn: APP_SESSION_TTL_MS,
    })
    .commit();
  if (!res.ok) return null;
  logger.info("app", "Device link redeemed", { userId: dl.value.userId });
  return sessionToken;
}

/** Resolve an app-session bearer token to its userId (or null). */
export async function getAppSessionUser(
  bearer: string | null,
): Promise<string | null> {
  if (!bearer) return null;
  const kv = await getKvAsync();
  if (!kv) return null;
  const s = await kv.get<{ userId: string }>(["app_session", bearer]);
  return s.value?.userId ?? null;
}

/** Pull the app-session bearer from the Authorization header. */
export function appBearer(req: Request): string | null {
  const m = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// ── Channel views (secrets masked for the browser) ──

const SECRET_KEYS = /token|secret|apikey|api_key|password|key$/i;

/** Redact secret-looking metadata values before sending config to the browser. */
export function maskChannel(ch: ChannelConfig): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ch.metadata ?? {})) {
    metadata[k] = SECRET_KEYS.test(k) && typeof v === "string" && v.length > 0
      ? "••••••••"
      : v;
  }
  return {
    id: ch.id,
    name: ch.name ?? "",
    type: ch.type,
    direction: ch.direction,
    enabled: ch.enabled,
    agentId: ch.agentId,
    runInBackground: ch.runInBackground ?? false,
    prompt: ch.prompt ?? "",
    metadata,
  };
}

export async function listUserChannels(
  userId: string,
): Promise<Record<string, unknown>[]> {
  const channels = await getChannels(userId);
  return channels.map(maskChannel);
}

export async function deleteUserChannel(
  userId: string,
  channelId: string,
): Promise<boolean> {
  const ok = await removeChannel(userId, channelId);
  logger.info("app", "Channel deleted via app", { userId, channelId, ok });
  return ok;
}

export async function patchUserChannel(
  userId: string,
  channelId: string,
  patch: { enabled?: boolean; name?: string; prompt?: string },
): Promise<boolean> {
  const ok = await updateChannelFields(userId, channelId, patch);
  logger.info("app", "Channel patched via app", {
    userId,
    channelId,
    keys: Object.keys(patch).join(","),
    ok,
  });
  return ok;
}

// ── The web UI (vanilla, no build step, light+dark, SVG icons) ──

export function renderAppPage(): string {
  return APP_HTML;
}

const APP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>CHAOS — your channels</title>
<style>
  :root { --bg:#fff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --card:#f9fafb; --accent:#4338ca; --danger:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e5e7eb; --muted:#9ca3af; --line:#262b33; --card:#161a20; --accent:#8b9cff; --danger:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  main { max-width:760px; margin:0 auto; padding:24px; }
  .muted { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:12px; }
  .row { display:flex; align-items:center; gap:12px; }
  .row .grow { flex:1; min-width:0; }
  .name { font-weight:600; }
  .badge { font-size:11px; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:999px; padding:2px 8px; color:var(--muted); }
  .meta { font-family:ui-monospace,monospace; font-size:12px; color:var(--muted); margin-top:8px; white-space:pre-wrap; word-break:break-all; }
  button { font:inherit; border:1px solid var(--line); background:transparent; color:var(--fg); border-radius:8px; padding:6px 10px; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  button.danger { color:var(--danger); }
  .icon { width:16px; height:16px; vertical-align:-3px; }
  .grouptitle { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:24px 0 8px; }
  .empty { color:var(--muted); text-align:center; padding:40px 0; }
  .err { color:var(--danger); }
</style></head>
<body>
<header>
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>
  <h1>Your CHAOS channels</h1>
</header>
<main id="main"><p class="muted">Loading…</p></main>
<script>
const SVG = {
  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
};
const main = document.getElementById('main');
let token = null;

function api(path, opts={}) {
  return fetch('/app/api' + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers||{}) },
  });
}

async function boot() {
  const url = new URL(location.href);
  const link = url.searchParams.get('token');
  token = sessionStorage.getItem('chaos_app_session');
  if (link) {
    // Redeem the one-time device link for a session, then clean the URL.
    const r = await fetch('/app/api/session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: link }) });
    if (r.ok) {
      token = (await r.json()).sessionToken;
      sessionStorage.setItem('chaos_app_session', token);
      history.replaceState({}, '', '/app');
    } else {
      main.innerHTML = '<p class="err">That link is invalid or expired. Run <code>chaos-relay configure</code> again to get a fresh one.</p>';
      return;
    }
  }
  if (!token) {
    main.innerHTML = '<p class="muted">Open this page from the link produced by <code>chaos-relay configure</code> (or <code>/chaos-relay configure</code> in your agent).</p>';
    return;
  }
  render();
}

async function render() {
  const r = await api('/channels');
  if (r.status === 401) {
    sessionStorage.removeItem('chaos_app_session');
    main.innerHTML = '<p class="err">Session expired. Run <code>chaos-relay configure</code> for a new link.</p>';
    return;
  }
  const channels = await r.json();
  if (!channels.length) {
    main.innerHTML = '<div class="empty">No channels yet. Add one from your agent (e.g. "register a Telegram bot"), then refresh.</div>';
    return;
  }
  const byType = {};
  for (const c of channels) (byType[c.type] ??= []).push(c);
  let html = '<p class="muted">' + channels.length + ' channel' + (channels.length===1?'':'s') + ' on this key. You can have as many of each type as you like.</p>';
  for (const type of Object.keys(byType).sort()) {
    html += '<div class="grouptitle">' + esc(type) + ' (' + byType[type].length + ')</div>';
    for (const c of byType[type]) html += card(c);
  }
  main.innerHTML = html;
}

function card(c) {
  const metaLines = Object.entries(c.metadata||{}).map(([k,v]) => esc(k)+': '+esc(typeof v==='string'?v:JSON.stringify(v))).join('\\n');
  return '<div class="card" data-id="'+esc(c.id)+'">'
    + '<div class="row"><div class="grow"><span class="name">'+esc(c.name||c.id)+'</span> '
    + '<span class="badge">'+esc(c.direction)+'</span> '
    + (c.enabled?'':'<span class="badge">disabled</span>')+'</div>'
    + '<button data-act="toggle">'+(c.enabled?'Disable':'Enable')+'</button>'
    + '<button class="danger" data-act="delete" title="Delete">'+SVG.trash+'</button></div>'
    + (metaLines?'<div class="meta">'+metaLines+'</div>':'')
    + '</div>';
}

main.addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const card = btn.closest('.card'); if (!card) return;
  const id = card.dataset.id;
  const act = btn.dataset.act;
  btn.disabled = true;
  if (act === 'delete') {
    if (!confirm('Delete this channel? This cannot be undone.')) { btn.disabled=false; return; }
    await api('/channels/' + encodeURIComponent(id), { method:'DELETE' });
  } else if (act === 'toggle') {
    const enabling = btn.textContent.trim() === 'Enable';
    await api('/channels/' + encodeURIComponent(id), { method:'PATCH', body: JSON.stringify({ enabled: enabling }) });
  }
  render();
});

function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
boot();
</script></body></html>`;
