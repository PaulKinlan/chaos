// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

import { validateAuth, createSession, addChannel, removeChannel, getChannels, getSessionByApiKey, type UserSession } from './auth.ts';
import { getMessages, getResponses, startMessageCleanup } from './store.ts';
import { handleWebhook } from './channels/webhook.ts';
import { handleReply, type ReplyPayload } from './channels/responder.ts';
import { registerTelegramBot, handleTelegramWebhook } from './channels/telegram.ts';
import { initServerKeyPair, getServerPublicKey } from './crypto.ts';
import { initKv } from './kv.ts';
import { RateLimiter, RATE_LIMITS } from './rate-limit.ts';
import { sanitizeMessage } from './sanitize.ts';
import { logger, requestLog } from './logger.ts';
import { addConnection, removeConnection } from './ws.ts';
import type { ChannelConfig } from '@chaos/shared';

const PORT = parseInt(Deno.env.get('PORT') || '8787');
const VERSION = '0.1.0';

// Lazy initialization — runs once on first request, not during module warmup
let initialized = false;
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await initKv();
  await initServerKeyPair();
  startMessageCleanup();
}

// Rate limiter instance
const rateLimiter = new RateLimiter();

// Admin session tokens (token -> creation timestamp)
const adminSessions = new Map<string, number>();

// CORS headers for cross-origin requests from the extension
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Timestamp, X-Nonce, X-Signature',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function getClientIP(req: Request): string {
  // Check common proxy headers
  return req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || req.headers.get('X-Real-IP')
    || 'unknown';
}

// On Deno Deploy, port is managed by the platform; locally use PORT env
const serveOptions = Deno.env.get('DENO_DEPLOYMENT_ID') ? {} : { port: PORT };

Deno.serve(serveOptions, async (req: Request) => {
  // Lazy init on first request (avoids blocking Deno Deploy warmup)
  await ensureInitialized();

  const url = new URL(req.url);
  const method = req.method;
  const reqData = requestLog(req, 'server', 'request');

  // Log every incoming request
  logger.info('server', 'Incoming request', reqData);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Public endpoints (no auth) ──

  // Health check / status page
  if (url.pathname === '/health' && method === 'GET') {
    const { isKvAvailable } = await import('./kv.ts');
    const { getConnectionCount } = await import('./ws.ts');
    return json({
      status: 'ok',
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
    });
  }

  // ── Admin dashboard (session cookie auth) ──

  // Admin session tokens (in-memory, short-lived)
  const ADMIN_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

  function verifyAdminSession(req: Request): boolean {
    const cookie = req.headers.get('cookie') || '';
    const match = cookie.match(/chaos_admin=([^;]+)/);
    if (!match) return false;
    const token = match[1];
    const stored = adminSessions.get(token);
    if (!stored) return false;
    if (Date.now() - stored > ADMIN_SESSION_TTL) {
      adminSessions.delete(token);
      return false;
    }
    return true;
  }

  // Login page
  if (url.pathname === '/admin/login' && method === 'GET') {
    const adminKey = Deno.env.get('CHAOS_ADMIN_KEY');
    if (!adminKey) return error('Admin not configured (set CHAOS_ADMIN_KEY env var)', 503);
    return new Response(ADMIN_LOGIN_HTML, {
      headers: { 'Content-Type': 'text/html', ...corsHeaders },
    });
  }

  // Login POST
  if (url.pathname === '/admin/login' && method === 'POST') {
    const adminKey = Deno.env.get('CHAOS_ADMIN_KEY');
    if (!adminKey) return error('Admin not configured', 503);
    try {
      const body = await req.json();
      if (body.password !== adminKey) {
        return new Response(JSON.stringify({ error: 'Invalid password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const token = crypto.randomUUID();
      adminSessions.set(token, Date.now());
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `chaos_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=14400`,
          ...corsHeaders,
        },
      });
    } catch {
      return error('Invalid request body');
    }
  }

  // Admin dashboard page
  if (url.pathname === '/admin' && method === 'GET') {
    if (!verifyAdminSession(req)) {
      return new Response(null, { status: 302, headers: { Location: '/admin/login' } });
    }
    return new Response(ADMIN_DASHBOARD_HTML, {
      headers: { 'Content-Type': 'text/html', ...corsHeaders },
    });
  }

  // Admin status API (used by dashboard JS)
  if (url.pathname === '/admin/status' && method === 'GET') {
    if (!verifyAdminSession(req)) return error('Unauthorized', 401);

    const { isKvAvailable, getKv } = await import('./kv.ts');
    const { getConnectionCount } = await import('./ws.ts');

    const sessions: Array<{ userId: string; channels: number; channelTypes: string[]; createdAt: string; wsConnections: number }> = [];
    if (isKvAvailable() && getKv()) {
      const iter = getKv()!.list<UserSession>({ prefix: ['sessions'] });
      for await (const entry of iter) {
        const s = entry.value;
        sessions.push({
          userId: s.userId,
          channels: s.channels.length,
          channelTypes: s.channels.map(c => c.type),
          createdAt: s.createdAt,
          wsConnections: getConnectionCount(s.userId),
        });
      }
    }

    return json({
      status: 'ok',
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
      sessions,
    });
  }

  // Admin logout
  if (url.pathname === '/admin/logout' && method === 'POST') {
    const cookie = req.headers.get('cookie') || '';
    const match = cookie.match(/chaos_admin=([^;]+)/);
    if (match) adminSessions.delete(match[1]);
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin/login',
        'Set-Cookie': 'chaos_admin=; Path=/admin; HttpOnly; Max-Age=0',
      },
    });
  }

  // Auth registration
  if (url.pathname === '/auth/register' && method === 'POST') {
    // Rate limit: 5/hour per IP
    const ip = getClientIP(req);
    if (!rateLimiter.check(`register:${ip}`, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowMs)) {
      logger.warn('server', 'Rate limit hit for registration', { ip });
      return error('Too many registration attempts. Try again later.', 429);
    }

    let publicKey: JsonWebKey | undefined;
    try {
      const body = await req.json();
      if (body.publicKey) {
        publicKey = body.publicKey;
      }
    } catch {
      // No body or invalid JSON — that's fine, publicKey is optional for backwards compat
    }

    const session = await createSession(publicKey);
    const serverPublicKey = getServerPublicKey();

    logger.info('server', 'New session registered', { userId: session.userId, hasPublicKey: !!publicKey });

    return json({
      userId: session.userId,
      apiKey: session.apiKey,
      serverPublicKey,
    });
  }

  // Webhook ingestion (auth via URL token, not Bearer)
  const webhookMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (webhookMatch && method === 'POST') {
    const channelId = webhookMatch[1];

    // Rate limit: 60/min per channel
    if (!rateLimiter.check(`webhook:${channelId}`, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowMs)) {
      logger.warn('server', 'Rate limit hit for webhook', { channelId });
      return error('Too many webhook requests. Try again later.', 429);
    }

    const resp = await handleWebhook(channelId, req);
    // Add CORS headers to webhook responses too
    const body = await resp.text();
    logger.info('server', 'Webhook response', { channelId, status: resp.status });
    return new Response(body, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers.entries()), ...corsHeaders },
    });
  }

  // Responses endpoint (for external services to poll for agent replies)
  const responsesMatch = url.pathname.match(/^\/responses\/([^/]+)$/);
  if (responsesMatch && method === 'GET') {
    const channelId = responsesMatch[1];
    const since = url.searchParams.get('since') || undefined;
    const responses = getResponses(channelId, since);
    logger.info('server', 'Responses polled', { channelId, count: responses.length });
    return json({ responses, since: new Date().toISOString() });
  }

  // Telegram webhook ingestion (auth via URL secret, not Bearer)
  const telegramMatch = url.pathname.match(/^\/telegram\/([^/]+)$/);
  if (telegramMatch && method === 'POST') {
    const channelId = telegramMatch[1];

    // Rate limit: 60/min per channel (same as webhooks)
    if (!rateLimiter.check(`webhook:${channelId}`, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowMs)) {
      logger.warn('server', 'Rate limit hit for Telegram webhook', { channelId });
      return error('Too many webhook requests. Try again later.', 429);
    }

    const resp = await handleTelegramWebhook(channelId, req);
    const body = await resp.text();
    logger.info('server', 'Telegram webhook response', { channelId, status: resp.status });
    return new Response(body, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers.entries()), ...corsHeaders },
    });
  }

  // ── WebSocket upgrade ──

  if (url.pathname === '/ws' && req.headers.get('upgrade') === 'websocket') {
    const token = url.searchParams.get('token');
    if (!token) {
      return error('Missing token query parameter', 401);
    }

    const wsSession = await getSessionByApiKey(token);
    if (!wsSession) {
      return error('Invalid token', 401);
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    const wsUserId = wsSession.userId;

    socket.onopen = () => {
      addConnection(wsUserId, socket);
      logger.info('server', 'WebSocket connected', { userId: wsUserId });
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reply') {
          const payload: ReplyPayload = {
            channelType: data.channelType,
            channelId: data.channelId,
            replyTo: data.replyTo,
            content: data.content,
            metadata: data.metadata,
          };
          if (!payload.channelId || !payload.content) {
            socket.send(JSON.stringify({ type: 'error', error: 'Missing channelId or content' }));
            return;
          }
          const sanitized = sanitizeMessage(payload.content);
          if (!sanitized.valid) {
            socket.send(JSON.stringify({ type: 'error', error: sanitized.error || 'Invalid message content' }));
            return;
          }
          payload.content = sanitized.content;
          const result = handleReply(wsUserId, payload);
          socket.send(JSON.stringify({ type: 'reply_ack', ...result }));
        } else if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      }
    };

    socket.onclose = () => {
      removeConnection(wsUserId, socket);
      logger.info('server', 'WebSocket disconnected', { userId: wsUserId });
    };

    socket.onerror = (err: Event | ErrorEvent) => {
      const msg = (err as ErrorEvent).message || (err as ErrorEvent).error || err.type || 'unknown';
      logger.error('server', 'WebSocket error', { userId: wsUserId, error: String(msg) });
      removeConnection(wsUserId, socket);
    };

    return response;
  }

  // ── Authenticated endpoints ──

  const authResult = await validateAuth(req);
  if (!authResult) {
    logger.warn('server', 'Unauthorized request', reqData);
    return error('Unauthorized. Include Authorization: Bearer <apiKey>', 401);
  }

  const { session } = authResult;

  // Poll for messages
  if (url.pathname === '/messages' && method === 'GET') {
    // Rate limit: 120/min per user
    if (!rateLimiter.check(`messages:${session.userId}`, RATE_LIMITS.messages.limit, RATE_LIMITS.messages.windowMs)) {
      logger.warn('server', 'Rate limit hit for messages poll', { userId: session.userId });
      return error('Too many poll requests. Try again later.', 429);
    }

    const since = url.searchParams.get('since') || undefined;
    const messages = getMessages(session.userId, since);
    logger.info('server', 'Messages polled', { userId: session.userId, count: messages.length });
    return json({ messages, since: new Date().toISOString() });
  }

  // Send a reply
  if (url.pathname === '/reply' && method === 'POST') {
    // Rate limit: 30/min per user
    if (!rateLimiter.check(`reply:${session.userId}`, RATE_LIMITS.reply.limit, RATE_LIMITS.reply.windowMs)) {
      logger.warn('server', 'Rate limit hit for reply', { userId: session.userId });
      return error('Too many reply requests. Try again later.', 429);
    }

    try {
      const payload: ReplyPayload = await req.json();
      if (!payload.channelId || !payload.content) {
        logger.warn('server', 'Reply missing required fields', { userId: session.userId });
        return error('Missing channelId or content');
      }

      // Sanitize reply content
      const sanitized = sanitizeMessage(payload.content);
      if (!sanitized.valid) {
        logger.warn('server', 'Reply content failed sanitization', { userId: session.userId });
        return error(sanitized.error || 'Invalid message content');
      }
      payload.content = sanitized.content;

      const result = handleReply(session.userId, payload);
      logger.info('server', 'Reply sent', { userId: session.userId, channelId: payload.channelId, channelType: payload.channelType });
      return json(result);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // Register a Telegram bot channel
  if (url.pathname === '/channels/telegram/register' && method === 'POST') {
    // Rate limit: 10/hour per user (same as channels)
    if (!rateLimiter.check(`channels:${session.userId}`, RATE_LIMITS.channels.limit, RATE_LIMITS.channels.windowMs)) {
      logger.warn('server', 'Rate limit hit for Telegram channel registration', { userId: session.userId });
      return error('Too many channel registration requests. Try again later.', 429);
    }

    try {
      const body = await req.json();
      const botToken = body.botToken;
      if (!botToken || typeof botToken !== 'string') {
        return error('Missing or invalid botToken');
      }

      const channelId = crypto.randomUUID();
      const serverBaseUrl = url.origin;

      const { botUsername, webhookSecret } = await registerTelegramBot(
        session.userId,
        botToken,
        serverBaseUrl,
        channelId,
      );

      // Encrypt the bot token before storing
      const { encryptToken } = await import('./crypto.ts');
      const encryptedToken = await encryptToken(botToken);

      const channel: ChannelConfig = {
        id: channelId,
        type: 'telegram',
        agentId: body.agentId || '',
        enabled: true,
        metadata: {
          botToken: encryptedToken,  // Encrypted at rest
          botTokenPlain: botToken,   // Kept in memory only, not persisted
          botUsername,
          webhookSecret,
        },
      };

      await addChannel(session.userId, channel);

      logger.info('server', 'Telegram bot channel registered', { userId: session.userId, channelId, botUsername });
      return json({ channelId, botUsername }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('server', 'Telegram registration failed', { userId: session.userId, error: message });
      return error(`Telegram registration failed: ${message}`);
    }
  }

  // Register a channel
  if (url.pathname === '/channels' && method === 'POST') {
    // Rate limit: 10/hour per user
    if (!rateLimiter.check(`channels:${session.userId}`, RATE_LIMITS.channels.limit, RATE_LIMITS.channels.windowMs)) {
      logger.warn('server', 'Rate limit hit for channel registration', { userId: session.userId });
      return error('Too many channel registration requests. Try again later.', 429);
    }

    try {
      const body = await req.json();
      const channel: ChannelConfig = {
        id: body.id || crypto.randomUUID(),
        type: body.type || 'webhook',
        agentId: body.agentId || '',
        enabled: body.enabled !== false,
        metadata: body.metadata || {},
      };

      // For webhook channels, generate a secret token
      if (channel.type === 'webhook' && !channel.metadata['webhookSecret']) {
        channel.metadata['webhookSecret'] = crypto.randomUUID();
      }

      await addChannel(session.userId, channel);

      // Build the webhook URL for the user
      const webhookUrl = channel.type === 'webhook'
        ? `${url.origin}/webhook/${channel.id}?token=${channel.metadata['webhookSecret']}`
        : undefined;

      logger.info('server', 'Channel registered', { userId: session.userId, channelId: channel.id, type: channel.type });
      return json({ channel, webhookUrl }, 201);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // List channels
  if (url.pathname === '/channels' && method === 'GET') {
    const channels = await getChannels(session.userId);
    logger.info('server', 'Channels listed', { userId: session.userId, count: channels.length });
    return json({ channels });
  }

  // Delete a channel
  const channelDeleteMatch = url.pathname.match(/^\/channels\/([^/]+)$/);
  if (channelDeleteMatch && method === 'DELETE') {
    const channelId = channelDeleteMatch[1];
    const removed = await removeChannel(session.userId, channelId);
    if (!removed) {
      logger.warn('server', 'Channel not found for deletion', { userId: session.userId, channelId });
      return error('Channel not found', 404);
    }
    logger.info('server', 'Channel deleted', { userId: session.userId, channelId });
    return json({ ok: true });
  }

  logger.warn('server', 'Route not found', reqData);
  return error('Not found', 404);
});

logger.info('server', 'CHAOS relay server started', { port: PORT, version: VERSION });

// ── Admin HTML templates ──

const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHAOS Admin - Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;width:100%;max-width:360px}
  h1{font-size:18px;margin-bottom:16px;color:#f0f3f6}
  input{width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;margin-bottom:12px}
  input:focus{outline:none;border-color:#58a6ff}
  button{width:100%;padding:8px 12px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;font-weight:500}
  button:hover{background:#2ea043}
  .error{color:#f85149;font-size:12px;margin-bottom:8px;display:none}
</style></head><body>
<div class="card">
  <h1>CHAOS Relay Admin</h1>
  <div class="error" id="err"></div>
  <form id="f">
    <input type="password" id="pw" placeholder="Admin password" autofocus>
    <button type="submit">Log in</button>
  </form>
</div>
<script>
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const pw=document.getElementById('pw').value;
  const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(r.ok){location.href='/admin'}
  else{const d=await r.json().catch(()=>({}));const el=document.getElementById('err');el.textContent=d.error||'Login failed';el.style.display='block'}
};
</script></body></html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHAOS Admin Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;padding:24px}
  h1{font-size:20px;margin-bottom:4px}
  .subtitle{color:#8b949e;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px}
  .stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
  .stat-value{font-size:24px;font-weight:600;color:#f0f3f6}
  .stat-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}
  .stat-ok{color:#3fb950}.stat-warn{color:#d29922}.stat-err{color:#f85149}
  h2{font-size:16px;margin-bottom:12px;color:#f0f3f6}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px 12px;border-bottom:1px solid #30363d;color:#8b949e;font-weight:500}
  td{padding:8px 12px;border-bottom:1px solid #21262d}
  .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:500}
  .badge-tg{background:#2b5278;color:#7bc8f6}.badge-wh{background:#2d3a2d;color:#7ee787}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
  .btn-logout{background:none;border:1px solid #30363d;border-radius:6px;color:#8b949e;padding:4px 12px;cursor:pointer;font-size:12px}
  .btn-logout:hover{color:#f0f3f6;border-color:#8b949e}
  .btn-refresh{background:none;border:1px solid #30363d;border-radius:6px;color:#58a6ff;padding:4px 12px;cursor:pointer;font-size:12px;margin-right:8px}
  #status{font-size:11px;color:#8b949e}
</style></head><body>
<div class="topbar">
  <div><h1>CHAOS Relay Admin</h1><div class="subtitle">Server dashboard</div></div>
  <div>
    <span id="status"></span>
    <button class="btn-refresh" onclick="load()">Refresh</button>
    <form action="/admin/logout" method="POST" style="display:inline"><button class="btn-logout" type="submit">Logout</button></form>
  </div>
</div>
<div class="grid" id="stats"></div>
<h2>Sessions</h2>
<table><thead><tr><th>User ID</th><th>Channels</th><th>WebSocket</th><th>Created</th></tr></thead><tbody id="sessions"></tbody></table>
<script>
async function load(){
  document.getElementById('status').textContent='Loading...';
  try{
    const r=await fetch('/admin/status');
    if(r.status===401){location.href='/admin/login';return}
    const d=await r.json();
    document.getElementById('stats').innerHTML=
      '<div class="stat"><div class="stat-value '+(d.kv?'stat-ok':'stat-err')+'">'+(d.kv?'Connected':'Offline')+'</div><div class="stat-label">Deno KV</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.websockets+'</div><div class="stat-label">WebSockets</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.sessions.length+'</div><div class="stat-label">Sessions</div></div>'+
      '<div class="stat"><div class="stat-value">'+Math.floor(d.uptime/60)+'m</div><div class="stat-label">Uptime</div></div>';
    const tb=document.getElementById('sessions');
    tb.innerHTML=d.sessions.map(s=>
      '<tr><td><code>'+s.userId.slice(0,12)+'...</code></td>'+
      '<td>'+s.channelTypes.map(t=>'<span class="badge badge-'+(t==='telegram'?'tg':'wh')+'">'+t+'</span> ').join('')+(s.channels===0?'<span style="color:#8b949e">none</span>':'')+'</td>'+
      '<td>'+(s.wsConnections>0?'<span class="stat-ok">'+s.wsConnections+' active</span>':'<span style="color:#8b949e">0</span>')+'</td>'+
      '<td>'+new Date(s.createdAt).toLocaleString()+'</td></tr>'
    ).join('');
    document.getElementById('status').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(e){
    document.getElementById('status').textContent='Error: '+e.message;
  }
}
load();
setInterval(load,15000);
</script></body></html>`;
