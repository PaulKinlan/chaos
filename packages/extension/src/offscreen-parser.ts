/**
 * Offscreen Document — HTML Parser
 *
 * Receives raw HTML via chrome.runtime.onMessage, parses it with DOMParser,
 * extracts main content via Readability, and converts to markdown via Turndown.
 * Used by fetch_page to get real DOM parsing in the service worker context.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Strip noise elements
const NOISE_TAGS = new Set(['style', 'script', 'noscript', 'iframe', 'head', 'nav', 'footer', 'header', 'aside', 'form', 'input', 'button', 'select', 'textarea', 'svg']);
turndown.addRule('remove-noise', {
  filter: (node) => NOISE_TAGS.has(node.nodeName.toLowerCase()),
  replacement: () => '',
});

// Keep link text but remove the link itself
turndown.addRule('flatten-links', {
  filter: ['a'],
  replacement: (content) => content,
});

// Remove images
turndown.addRule('remove-images', {
  filter: ['img'],
  replacement: () => '',
});

// ── WebSocket management (persistent in offscreen document) ──

let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsBackoff = 5000;
const WS_MAX_BACKOFF = 60000;
const WS_PING_INTERVAL = 25000;
let wsPingTimer: ReturnType<typeof setInterval> | null = null;
let wsUrl: string | null = null;

function wsLog(msg: string): void {
  console.log(`[offscreen-ws] ${msg}`);
  // Forward log to service worker
  chrome.runtime.sendMessage({ type: 'wsLog', message: msg }).catch(() => {});
}

function wsConnect(url: string): void {
  wsUrl = url;
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }

  wsLog(`Connecting to ${url.replace(/token=[^&]+/, 'token=***')}`);
  try { ws = new WebSocket(url); } catch (err) {
    wsLog(`Failed: ${err}`);
    wsScheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    wsLog('Connected');
    wsBackoff = 5000;
    wsPingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
    }, WS_PING_INTERVAL);
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String(event.data));
      if (data.type === 'message' && (data.payload || data.message)) {
        const msg = data.payload || data.message;
        wsLog(`Message received: ${msg.id?.slice(0, 8) ?? '???'} from ${msg.channelType ?? 'unknown'}`);
        // Forward to service worker for processing
        chrome.runtime.sendMessage({ type: 'wsChannelMessage', message: msg }).catch(() => {});
      } else if (data.type === 'pong' || data.type === 'ping') {
        // keepalive
      } else if (data.type === 'reply_ack') {
        wsLog(`Reply ack: ${data.responseId?.slice(0, 8) ?? '???'}`);
      }
    } catch (err) {
      wsLog(`Parse error: ${err}`);
    }
  });

  ws.addEventListener('close', (event) => {
    wsLog(`Closed (code=${event.code}, reason=${event.reason || 'none'})`);
    ws = null;
    if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
    if (event.code === 1008 || event.reason?.includes('401')) {
      wsLog('Auth failure — not reconnecting');
      return;
    }
    if (wsUrl) wsScheduleReconnect();
  });

  ws.addEventListener('error', () => {
    wsLog('Error — will reconnect on close');
  });
}

function wsScheduleReconnect(): void {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsLog(`Reconnecting in ${wsBackoff / 1000}s...`);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    if (wsUrl) wsConnect(wsUrl);
  }, wsBackoff);
  wsBackoff = Math.min(wsBackoff * 2, WS_MAX_BACKOFF);
}

function wsDisconnect(): void {
  wsUrl = null;
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  wsLog('Disconnected');
}

// ── Message handler (HTML parsing + WS control) ──

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; html?: string; url?: string; wsUrl?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    // WebSocket control messages
    if (message.type === 'wsConnect' && message.wsUrl) {
      wsConnect(message.wsUrl);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'wsDisconnect') {
      wsDisconnect();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'wsStatus') {
      sendResponse({ connected: ws !== null && ws.readyState === WebSocket.OPEN });
      return true;
    }

    if (message.type !== 'parseHtml' || !message.html) return;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(message.html, 'text/html');

      // Set the base URL so Readability can resolve relative links
      if (message.url) {
        const base = doc.createElement('base');
        base.href = message.url;
        doc.head.appendChild(base);
      }

      let title = '';
      let content = '';

      // Try Readability
      try {
        const docClone = doc.cloneNode(true) as Document;
        const reader = new Readability(docClone);
        const article = reader.parse();

        if (article && article.content) {
          title = article.title || doc.title || '';
          content = turndown.turndown(article.content);
        }
      } catch {
        // Readability failed, fall through
      }

      // Fallback: extract from body
      if (!content) {
        title = doc.title || '';
        // Try main content selectors first
        const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content', '.content', '#content'];
        let html = '';
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 100) {
            html = el.innerHTML;
            break;
          }
        }
        if (!html) {
          html = doc.body?.innerHTML || '';
        }
        content = turndown.turndown(html);
      }

      // Truncate to 12000 chars
      sendResponse({
        title,
        content: content.slice(0, 12000),
      });
    } catch (err) {
      sendResponse({
        title: '',
        content: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return true; // async response
  },
);
