/**
 * Sandboxed Renderer
 *
 * Renders untrusted HTML content inside a sandboxed iframe for safe display.
 * The iframe uses srcdoc with sandbox="allow-scripts" (no allow-same-origin)
 * and auto-resizes based on content height reported via postMessage.
 */

const SANDBOX_ORIGIN = 'null'; // sandboxed iframes without allow-same-origin have origin "null"

/**
 * Check whether rendered HTML needs sandboxed rendering.
 * Returns true if the HTML contains elements that require isolation
 * (scripts, styles, forms, iframes).
 */
export function needsSandbox(html: string): boolean {
  return /<(script|style|form|iframe)[\s>]/i.test(html);
}

/**
 * Render HTML content inside a sandboxed iframe.
 *
 * @param html - The HTML content to render (should already be sanitized with DOMPurify for basic safety)
 * @param container - The DOM element to insert the iframe into
 */
export function renderInSandbox(html: string, container: HTMLElement): void {
  // Remove any existing iframe from prior renders
  const existingIframe = container.querySelector('iframe.sandbox-frame');
  if (existingIframe) {
    existingIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.className = 'sandbox-frame';
  iframe.sandbox.add('allow-scripts');
  // No allow-same-origin - the iframe cannot access parent DOM

  iframe.style.width = '100%';
  iframe.style.border = 'none';
  iframe.style.overflow = 'hidden';
  iframe.style.minHeight = '40px';
  iframe.style.display = 'block';
  iframe.style.background = 'transparent';

  // Build the srcdoc with a height-reporting script
  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #e0e0e0;
    background: transparent;
    padding: 8px;
    overflow: hidden;
  }
  a { color: #8b5cf6; }
  pre { background: #111; border: 1px solid #333; border-radius: 6px; padding: 10px; overflow-x: auto; margin: 8px 0; }
  code { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; }
</style>
</head>
<body>
${html}
<script>
(function() {
  function reportHeight() {
    var height = document.body.scrollHeight;
    window.parent.postMessage({ type: 'sandbox-resize', height: height }, '*');
  }
  // Report initial height
  reportHeight();
  // Re-measure after content settles (images, fonts, etc.)
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      reportHeight();
    });
  });
  // Also report on resize
  new ResizeObserver(function() {
    reportHeight();
  }).observe(document.body);
})();
</script>
</body>
</html>`;

  iframe.srcdoc = srcdoc;

  // Listen for height messages from this iframe
  const messageHandler = (event: MessageEvent) => {
    // Sandboxed iframes without allow-same-origin report origin as "null"
    if (event.source !== iframe.contentWindow) return;
    if (event.data && event.data.type === 'sandbox-resize' && typeof event.data.height === 'number') {
      iframe.style.height = event.data.height + 'px';
    }
  };

  window.addEventListener('message', messageHandler);

  // Clean up listener when iframe is removed from DOM
  const observer = new MutationObserver(() => {
    if (!container.contains(iframe)) {
      window.removeEventListener('message', messageHandler);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });

  container.appendChild(iframe);
}
