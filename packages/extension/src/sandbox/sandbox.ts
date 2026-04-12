/**
 * CHAOS Sandbox Script
 *
 * Runs in a sandboxed iframe with NO access to Chrome extension APIs.
 * Receives content via postMessage and renders it safely.
 *
 * Two modes:
 * - RENDER_CONTENT: sanitized HTML, no scripts
 * - RENDER_INTERACTIVE: HTML + CSS + separate JS scripts for interactive artifacts
 */

const contentEl = document.getElementById('content')!;

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  switch (data.type) {
    case 'RENDER_CONTENT': {
      // Standard sanitized HTML — no scripts
      contentEl.innerHTML = data.content || '';
      notifyComplete(data.messageId);
      break;
    }

    case 'RENDER_INTERACTIVE': {
      // Interactive HTML with separate scripts
      contentEl.innerHTML = data.content || '';

      // Schedule completion before scripts (resilient to script errors)
      const msgId = data.messageId;
      setTimeout(() => notifyComplete(msgId), 100);

      // Execute scripts in order
      if (Array.isArray(data.scripts)) {
        for (const scriptContent of data.scripts) {
          try {
            const el = document.createElement('script');
            el.textContent = scriptContent;
            document.body.appendChild(el);
          } catch (err) {
            console.error('[sandbox] Script error:', err);
          }
        }
      }
      break;
    }

    case 'CLEAR_CONTENT':
      contentEl.innerHTML = '';
      break;

    case 'SET_THEME':
      if (data.theme) {
        document.documentElement.setAttribute('data-theme', data.theme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      break;

    case 'GET_HEIGHT':
      window.parent.postMessage({
        type: 'HEIGHT_RESPONSE',
        messageId: data.messageId,
        height: document.body.scrollHeight,
      }, '*');
      break;
  }
});

function notifyComplete(messageId: number): void {
  window.parent.postMessage({
    type: 'RENDER_COMPLETE',
    messageId,
    height: document.body.scrollHeight,
  }, '*');
}

// Report ready
window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
