/**
 * SandboxRenderer
 *
 * Loads the manifest-declared sandbox page (src/sandbox/sandbox.html)
 * which has all JavaScript inline. No external script references.
 * The manifest sandbox gives it its own origin + CSP context.
 * No iframe sandbox attribute needed — manifest handles isolation.
 *
 * Communication via postMessage. Two rendering modes:
 * - Standard: sanitized HTML, no scripts
 * - Interactive: HTML + CSS + JS (scripts extracted and passed separately)
 */

import DOMPurify from 'dompurify';

const STANDARD_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
    'ul', 'ol', 'li', 'a', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    'del', 'sup', 'sub', 'input', 'img',
  ],
  ALLOWED_ATTR: ['href', 'class', 'type', 'checked', 'disabled', 'src', 'alt', 'width', 'height'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed'],
};

const INTERACTIVE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
    'ul', 'ol', 'li', 'a', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    'del', 'sup', 'sub', 'input', 'img', 'label', 'button', 'select', 'option',
    'textarea', 'form', 'details', 'summary', 'canvas', 'style',
    'svg', 'path', 'circle', 'rect', 'line', 'g', 'text', 'defs',
  ],
  ALLOWED_ATTR: [
    'href', 'class', 'id', 'type', 'checked', 'disabled', 'src', 'alt',
    'width', 'height', 'for', 'data-*', 'aria-label', 'role', 'tabindex',
    'name', 'value', 'placeholder', 'style',
    'viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'cx', 'cy', 'r',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'transform',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
};

export function needsSandbox(html: string): boolean {
  return /<(script|style|form|iframe|canvas)[\s>]/i.test(html);
}

export class SandboxRenderer {
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private messageId = 0;
  private pendingMessages = new Map<number, { resolve: (h?: number) => void; reject: (e: unknown) => void }>();
  private boundHandler: (e: MessageEvent) => void;
  public fillContainer = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandler = this.handleMessage.bind(this);
    this.readyPromise = new Promise(resolve => { this.readyResolve = resolve; });
    window.addEventListener('message', this.boundHandler);

    this.iframe = document.createElement('iframe');
    // Load the manifest-declared sandbox page — all JS is inline inside it.
    // No iframe sandbox attribute — the manifest sandbox declaration handles isolation.
    this.iframe.src = chrome.runtime.getURL('src/sandbox/sandbox.html');
    this.iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;min-height:100px;background:#0d1117;border-radius:6px;';
    this.container.appendChild(this.iframe);
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== this.iframe?.contentWindow) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'SANDBOX_READY') {
      this.isReady = true;
      this.readyResolve?.();
      return;
    }

    if (data.type === 'RENDER_COMPLETE' || data.type === 'HEIGHT_RESPONSE') {
      // Keep iframe at height:100% — the sandbox body scrolls internally.
      // Don't set pixel height, as it causes content to overflow the container
      // and get clipped without a scrollbar.
      const pending = this.pendingMessages.get(data.messageId);
      if (pending) {
        pending.resolve(data.height);
        this.pendingMessages.delete(data.messageId);
      }
    }
  }

  async render(html: string): Promise<number | undefined> {
    await this.readyPromise;
    if (!this.iframe?.contentWindow) throw new Error('Sandbox not available');
    const sanitized = DOMPurify.sanitize(html, STANDARD_CONFIG);
    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.iframe!.contentWindow!.postMessage({ type: 'RENDER_CONTENT', content: sanitized, messageId: id }, '*');
      setTimeout(() => { if (this.pendingMessages.has(id)) { this.pendingMessages.delete(id); reject(new Error('timeout')); } }, 5000);
    });
  }

  async renderInteractive(html: string): Promise<number | undefined> {
    await this.readyPromise;
    if (!this.iframe?.contentWindow) throw new Error('Sandbox not available');

    // Extract scripts before sending — they get injected separately in the sandbox
    const scripts: string[] = [];
    const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) scripts.push(m[1]!);
    const htmlWithoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    // For interactive mode: pass HTML as-is (no DOMPurify).
    // The sandbox is the security boundary — it has no access to extension
    // APIs, no access to parent DOM, no access to chrome.*. The content
    // runs in complete isolation. DOMPurify would strip styles, event
    // handlers, and interactivity that the AI-generated content needs.
    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.iframe!.contentWindow!.postMessage({ type: 'RENDER_INTERACTIVE', content: htmlWithoutScripts, scripts, messageId: id }, '*');
      setTimeout(() => { if (this.pendingMessages.has(id)) { this.pendingMessages.delete(id); reject(new Error('timeout')); } }, 5000);
    });
  }

  clear(): void {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage({ type: 'CLEAR_CONTENT' }, '*');
      this.iframe.style.height = '100px';
    }
  }

  destroy(): void {
    window.removeEventListener('message', this.boundHandler);
    if (this.iframe) { this.iframe.remove(); this.iframe = null; }
    this.pendingMessages.clear();
  }

  get ready(): boolean { return this.isReady; }
  waitForReady(): Promise<void> { return this.readyPromise; }
}

export function renderInSandbox(html: string, container: HTMLElement): void {
  const renderer = new SandboxRenderer(container);
  if (/<script[\s>]/i.test(html)) renderer.renderInteractive(html);
  else renderer.render(html);
}

export function createSandboxRenderer(container: HTMLElement): SandboxRenderer {
  return new SandboxRenderer(container);
}
