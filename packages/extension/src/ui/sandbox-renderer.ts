/**
 * SandboxRenderer — renders untrusted content in a sandboxed srcdoc iframe.
 *
 * Uses iframe sandbox="allow-scripts allow-forms" with srcdoc containing
 * all content inline. No external files, no manifest sandbox, no CSP conflicts.
 */

import DOMPurify from 'dompurify';

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

export function needsSandbox(html: string): boolean {
  return /<(script|style|form|iframe|canvas)[\s>]/i.test(html);
}

const BASE_STYLE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; margin: 0; }
body { font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.6; color: #e1e4e8; background: #0d1117; padding: 16px; overflow-wrap: break-word; }
a { color: #8b9cf6; }
pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; overflow-x: auto; margin: 8px 0; }
code { font-family: monospace; font-size: 13px; background: #161b22; padding: 2px 5px; border-radius: 3px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th, td { border: 1px solid #30363d; padding: 8px 12px; }
th { background: #161b22; font-weight: 600; color: #c9d1d9; }
h1,h2,h3,h4 { color: #c9d1d9; margin: 16px 0 8px; font-weight: 600; }
p { margin: 8px 0; }
ul,ol { margin: 8px 0; padding-left: 24px; }
blockquote { border-left: 3px solid #30363d; margin: 8px 0; padding: 4px 16px; color: #8b949e; }
hr { border: none; border-top: 1px solid #30363d; margin: 16px 0; }
img { max-width: 100%; }
button { cursor: pointer; }
`;

const RESIZE_SCRIPT = `
(function(){
  function r(){window.parent.postMessage({type:'sandbox-resize',height:document.body.scrollHeight},'*')}
  r();
  requestAnimationFrame(function(){requestAnimationFrame(r)});
  new ResizeObserver(r).observe(document.body);
})();
`;

function buildSrcdoc(bodyHtml: string, scripts: string[] = []): string {
  const scriptTags = scripts.map(s => `<script>${s}<\/script>`).join('\n');
  return `<!DOCTYPE html><html><head><style>${BASE_STYLE}</style></head><body>${bodyHtml}${scriptTags}<script>${RESIZE_SCRIPT}<\/script></body></html>`;
}

export class SandboxRenderer {
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement;
  private boundHandler: (e: MessageEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.boundHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundHandler);
    this.iframe = document.createElement('iframe');
    this.iframe.sandbox.add('allow-scripts');
    this.iframe.sandbox.add('allow-forms');
    this.iframe.style.cssText = 'width:100%;border:none;display:block;min-height:100px;background:#0d1117;border-radius:6px;';
    this.container.appendChild(this.iframe);
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== this.iframe?.contentWindow) return;
    if (event.data?.type === 'sandbox-resize' && typeof event.data.height === 'number') {
      this.iframe!.style.height = `${event.data.height}px`;
    }
  }

  async render(html: string): Promise<void> {
    if (!this.iframe) return;
    const sanitized = DOMPurify.sanitize(html, STANDARD_CONFIG);
    this.iframe.srcdoc = buildSrcdoc(sanitized);
  }

  async renderInteractive(html: string): Promise<void> {
    if (!this.iframe) return;
    const scripts: string[] = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push(match[1]!);
    }
    const htmlWithoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    const sanitized = DOMPurify.sanitize(htmlWithoutScripts, INTERACTIVE_CONFIG);
    this.iframe.srcdoc = buildSrcdoc(sanitized, scripts);
  }

  clear(): void {
    if (this.iframe) {
      this.iframe.srcdoc = '';
      this.iframe.style.height = '100px';
    }
  }

  destroy(): void {
    window.removeEventListener('message', this.boundHandler);
    if (this.iframe) { this.iframe.remove(); this.iframe = null; }
  }
}

export function renderInSandbox(html: string, container: HTMLElement): void {
  const renderer = new SandboxRenderer(container);
  if (/<script[\s>]/i.test(html)) {
    renderer.renderInteractive(html);
  } else {
    renderer.render(html);
  }
}

export function createSandboxRenderer(container: HTMLElement): SandboxRenderer {
  return new SandboxRenderer(container);
}
