/**
 * CHAOS Sandbox Script
 * Runs in manifest-declared sandbox page — no chrome.* API access.
 * Communication via postMessage only.
 */

const contentEl = document.getElementById('content')!;

function notifyComplete(messageId: number): void {
  window.parent.postMessage({
    type: 'RENDER_COMPLETE',
    messageId,
    height: document.body.scrollHeight,
  }, '*');
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'RENDER_CONTENT' && contentEl) {
    contentEl.innerHTML = data.content || '';
    requestAnimationFrame(() => notifyComplete(data.messageId));
  }
  else if (data.type === 'RENDER_INTERACTIVE' && contentEl) {
    contentEl.innerHTML = data.content || '';
    setTimeout(() => notifyComplete(data.messageId), 100);
    if (data.scripts && Array.isArray(data.scripts)) {
      for (const scriptContent of data.scripts) {
        try {
          const el = document.createElement('script');
          el.textContent = scriptContent;
          document.body.appendChild(el);
        } catch (e) { console.error('Script error:', e); }
      }
    }
  }
  else if (data.type === 'CLEAR_CONTENT' && contentEl) {
    contentEl.innerHTML = '';
  }
  else if (data.type === 'SET_THEME') {
    if (data.theme) document.documentElement.setAttribute('data-theme', data.theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  else if (data.type === 'GET_HEIGHT') {
    window.parent.postMessage({ type: 'HEIGHT_RESPONSE', messageId: data.messageId, height: document.body.scrollHeight }, '*');
  }
});

window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
