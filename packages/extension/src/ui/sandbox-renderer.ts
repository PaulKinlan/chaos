/**
 * SandboxRenderer — renders untrusted content in a manifest-declared sandbox page.
 *
 * Uses src/sandbox/sandbox.html declared in manifest.json's "sandbox" section.
 * The sandbox page has allow-scripts but NO access to chrome.* APIs.
 * Communication via postMessage only.
 *
 * Two modes:
 * - Standard: sanitized HTML, no scripts (markdown, text, JSON display)
 * - Interactive: HTML + CSS + JS (AI-generated apps, dashboards, HTML artifacts)
 *
 * Pattern from NotebookLM Chrome's SandboxRenderer.
 */

import DOMPurify from 'dompurify';

// Standard mode: strip scripts, styles, forms
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

// Interactive mode: allow styles and form elements, strip scripts (passed separately)
const INTERACTIVE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
    'ul', 'ol', 'li', 'a', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    'del', 'sup', 'sub', 'input', 'img', 'label', 'button', 'select', 'option',
    'textarea', 'form', 'details', 'summary', 'canvas', 'style',
    'svg', 'path', 'circle', 'rect', 'line', 'g', 'text', 'defs', 'clipPath', 'use',
  ],
  ALLOWED_ATTR: [
    'href', 'class', 'id', 'type', 'checked', 'disabled', 'src', 'alt',
    'width', 'height', 'for', 'data-*', 'aria-label', 'aria-hidden', 'role',
    'tabindex', 'name', 'value', 'placeholder', 'style',
    'viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'cx', 'cy', 'r',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'transform',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
};

/**
 * Check whether HTML content needs sandboxed rendering (has scripts/styles).
 */
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

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandler = this.handleMessage.bind(this);
    this.readyPromise = new Promise(resolve => { this.readyResolve = resolve; });
    this.init();
  }

  private init(): void {
    this.iframe = document.createElement('iframe');
    this.iframe.src = chrome.runtime.getURL('src/sandbox/sandbox.html');
    // Sandbox attributes match NotebookLM Chrome's working setup:
    // allow-scripts needed for the inline sandbox script + injected scripts
    // allow-forms needed for interactive content (buttons, keyboard events)
    // No allow-same-origin — complete isolation from extension
    this.iframe.sandbox.add('allow-scripts');
    this.iframe.sandbox.add('allow-forms');
    this.iframe.style.cssText = 'width:100%;border:none;display:block;min-height:100px;background:#0d1117;border-radius:6px;';

    window.addEventListener('message', this.boundHandler);
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
      if (data.height && this.iframe) {
        this.iframe.style.height = `${data.height + 16}px`; // Add padding
      }
      const pending = this.pendingMessages.get(data.messageId);
      if (pending) {
        pending.resolve(data.height);
        this.pendingMessages.delete(data.messageId);
      }
    }
  }

  /**
   * Render sanitized HTML (no scripts allowed).
   */
  async render(html: string): Promise<number | undefined> {
    await this.readyPromise;
    if (!this.iframe?.contentWindow) throw new Error('Sandbox not available');

    const sanitized = DOMPurify.sanitize(html, STANDARD_CONFIG);
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.iframe!.contentWindow!.postMessage({ type: 'RENDER_CONTENT', content: sanitized, messageId: id }, '*');
      setTimeout(() => {
        if (this.pendingMessages.has(id)) { this.pendingMessages.delete(id); reject(new Error('Render timeout')); }
      }, 5000);
    });
  }

  /**
   * Render interactive HTML with JavaScript.
   * Scripts are extracted, HTML is sanitized, scripts injected separately in the sandbox.
   */
  async renderInteractive(html: string): Promise<number | undefined> {
    await this.readyPromise;
    if (!this.iframe?.contentWindow) throw new Error('Sandbox not available');

    // Extract scripts before sanitization
    const scripts: string[] = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push(match[1]!);
    }

    const htmlWithoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    const sanitized = DOMPurify.sanitize(htmlWithoutScripts, INTERACTIVE_CONFIG);
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.iframe!.contentWindow!.postMessage({
        type: 'RENDER_INTERACTIVE', content: sanitized, scripts, messageId: id,
      }, '*');
      setTimeout(() => {
        if (this.pendingMessages.has(id)) { this.pendingMessages.delete(id); reject(new Error('Render timeout')); }
      }, 5000);
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

/**
 * Render HTML in a sandboxed iframe.
 * For backwards compatibility with existing renderInSandbox() calls.
 */
export function renderInSandbox(html: string, container: HTMLElement): void {
  const renderer = new SandboxRenderer(container);
  // Detect if content has scripts — use interactive mode
  if (/<script[\s>]/i.test(html)) {
    renderer.renderInteractive(html).catch(console.error);
  } else {
    renderer.render(html).catch(console.error);
  }
}

export function createSandboxRenderer(container: HTMLElement): SandboxRenderer {
  return new SandboxRenderer(container);
}
