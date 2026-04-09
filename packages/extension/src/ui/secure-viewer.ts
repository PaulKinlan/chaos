/**
 * Secure Content Viewer (Double Iframe Pattern)
 *
 * Renders untrusted content safely using two nested iframes:
 * - Outer iframe: sandbox="allow-scripts" — hosts toolbar with download/copy/close buttons
 * - Inner iframe: sandbox="" (NO permissions) — renders the actual content
 *
 * Content cannot access the extension's DOM, storage, or APIs.
 * Content cannot navigate the parent frame or run scripts.
 */

export interface SecureViewerOptions {
  type?: 'html' | 'markdown' | 'text' | 'json' | 'csv';
  title?: string;
  downloadFilename?: string;
  onClose?: () => void;
}

export interface SecureViewer {
  setContent(content: string, type?: SecureViewerOptions['type']): void;
  destroy(): void;
}

/** SVG icon strings for the toolbar (inline, no emoji) */
const ICONS = {
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};

/**
 * Detect content type from a file path extension.
 */
export function detectContentType(path: string): SecureViewerOptions['type'] {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'csv':
      return 'csv';
    case 'txt':
    default:
      return 'text';
  }
}

/**
 * Convert content to safe HTML based on type.
 */
function contentToHtml(content: string, type: string): string {
  const baseStyle = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #e1e4e8;
      background: #0d1117;
      padding: 16px;
      word-wrap: break-word;
    }
    a { color: #8b9cf6; }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 13px;
      background: #161b22;
      padding: 2px 5px;
      border-radius: 3px;
    }
    pre code { background: none; padding: 0; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
    }
    th, td {
      border: 1px solid #30363d;
      padding: 8px 12px;
      text-align: left;
      font-size: 13px;
    }
    th {
      background: #161b22;
      font-weight: 600;
      color: #c9d1d9;
    }
    tr:nth-child(even) { background: rgba(22, 27, 34, 0.5); }
    h1, h2, h3, h4, h5, h6 {
      color: #c9d1d9;
      margin: 16px 0 8px 0;
      font-weight: 600;
    }
    h1 { font-size: 1.5em; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
    h2 { font-size: 1.3em; border-bottom: 1px solid #30363d; padding-bottom: 6px; }
    h3 { font-size: 1.1em; }
    p { margin: 8px 0; }
    ul, ol { margin: 8px 0; padding-left: 24px; }
    li { margin: 4px 0; }
    blockquote {
      border-left: 3px solid #30363d;
      margin: 8px 0;
      padding: 4px 16px;
      color: #8b949e;
    }
    hr { border: none; border-top: 1px solid #30363d; margin: 16px 0; }
    img { max-width: 100%; }
  `;

  switch (type) {
    case 'html':
      // HTML content rendered directly — inner iframe sandbox="" prevents scripts
      return content;

    case 'markdown':
      return `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>${markdownToHtml(content)}</body></html>`;

    case 'json': {
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        formatted = content;
      }
      return `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body><pre><code>${escapeHtml(formatted)}</code></pre></body></html>`;
    }

    case 'csv':
      return `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body>${csvToTable(content)}</body></html>`;

    case 'text':
    default:
      return `<!DOCTYPE html><html><head><style>${baseStyle}</style></head><body><pre>${escapeHtml(content)}</pre></body></html>`;
  }
}

/**
 * Minimal markdown to HTML converter.
 * Handles headings, bold, italic, code blocks, inline code, lists, blockquotes, links, hrs, and paragraphs.
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      result.push('<hr>');
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      const level = headingMatch[1].length;
      result.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      result.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
        result.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      result.push(`<li>${inlineMarkdown(ulMatch[2])}</li>`);
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
        result.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      result.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList && line.trim() === '') {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Paragraph
    if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
    result.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  // Close any open blocks
  if (inCodeBlock) {
    result.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
  }
  if (inList) {
    result.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  return result.join('\n');
}

/** Process inline markdown: bold, italic, code, links, images */
function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  // Inline code (must be before bold/italic to avoid conflicts)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  return s;
}

/** Parse CSV into an HTML table */
function csvToTable(csv: string): string {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '<p>(empty CSV)</p>';

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const header = parseRow(lines[0]);
  let html = '<table><thead><tr>';
  for (const h of header) {
    html += `<th>${escapeHtml(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let i = 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    html += '<tr>';
    for (let j = 0; j < header.length; j++) {
      html += `<td>${escapeHtml(cells[j] || '')}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Unique ID generator for message routing */
let viewerIdCounter = 0;
function nextViewerId(): string {
  return `secure-viewer-${++viewerIdCounter}-${Date.now()}`;
}

/**
 * Build the srcdoc for the outer iframe.
 * Contains a toolbar and an inner iframe with sandbox="" (no permissions).
 */
function buildOuterSrcdoc(viewerId: string, title: string, showClose: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #0d1117; }
  .toolbar {
    height: 36px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 4px;
    flex-shrink: 0;
  }
  .toolbar-title {
    flex: 1;
    color: #e1e4e8;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
  }
  .toolbar-btn {
    background: none;
    border: 1px solid #30363d;
    color: #8b949e;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .toolbar-btn:hover {
    background: #21262d;
    color: #e1e4e8;
    border-color: #484f58;
  }
  .toolbar-btn.success svg { stroke: #3fb950; }
  .content-frame {
    width: 100%;
    height: calc(100% - 36px);
    border: none;
    background: #0d1117;
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="toolbar-title">${escapeHtml(title)}</span>
    <button class="toolbar-btn" id="btn-download" title="Download">${ICONS.download}</button>
    <button class="toolbar-btn" id="btn-copy" title="Copy to clipboard">${ICONS.copy}</button>
    ${showClose ? `<button class="toolbar-btn" id="btn-close" title="Close">${ICONS.close}</button>` : ''}
  </div>
  <iframe class="content-frame" id="content-frame" sandbox="" srcdoc=""></iframe>
  <script>
    var viewerId = ${JSON.stringify(viewerId)};

    // Listen for content updates from the parent extension page
    window.addEventListener('message', function(e) {
      if (e.data && e.data.viewerId === viewerId) {
        if (e.data.type === 'sv-set-content') {
          document.getElementById('content-frame').srcdoc = e.data.html;
        }
      }
    });

    // Signal parent that we're ready to receive content
    window.parent.postMessage({ type: 'sv-ready', viewerId: viewerId }, '*');

    document.getElementById('btn-download').addEventListener('click', function() {
      window.parent.postMessage({ type: 'sv-download', viewerId: viewerId }, '*');
    });

    document.getElementById('btn-copy').addEventListener('click', function() {
      window.parent.postMessage({ type: 'sv-copy', viewerId: viewerId }, '*');
      // Show success state
      var btn = document.getElementById('btn-copy');
      btn.classList.add('success');
      btn.innerHTML = ${JSON.stringify(ICONS.check)};
      setTimeout(function() {
        btn.classList.remove('success');
        btn.innerHTML = ${JSON.stringify(ICONS.copy)};
      }, 2000);
    });

    ${showClose ? `
    document.getElementById('btn-close').addEventListener('click', function() {
      window.parent.postMessage({ type: 'sv-close', viewerId: viewerId }, '*');
    });
    ` : ''}
  </script>
</body>
</html>`;
}

/**
 * Create a secure viewer that renders untrusted content using the double iframe pattern.
 *
 * @param container - The DOM element to mount the viewer into
 * @param content - The content string to render
 * @param options - Configuration options
 * @returns A SecureViewer instance with setContent() and destroy() methods
 */
export function createSecureViewer(
  container: HTMLElement,
  content: string,
  options?: SecureViewerOptions,
): SecureViewer {
  const viewerId = nextViewerId();
  const type = options?.type || 'text';
  const title = options?.title || '';
  const showClose = !!options?.onClose;

  // Track the raw content for copy/download
  let rawContent = content;
  let currentType = type;

  // Create the outer iframe
  const outerFrame = document.createElement('iframe');
  outerFrame.className = 'secure-viewer-frame';
  outerFrame.sandbox.add('allow-scripts');
  outerFrame.style.cssText = 'width:100%;height:100%;border:none;';
  outerFrame.srcdoc = buildOuterSrcdoc(viewerId, title, showClose);

  // Handle messages from the outer iframe
  const messageHandler = (event: MessageEvent) => {
    if (!event.data || event.data.viewerId !== viewerId) return;

    switch (event.data.type) {
      case 'sv-download': {
        const blob = new Blob([rawContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = options?.downloadFilename || 'content.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        break;
      }
      case 'sv-copy': {
        navigator.clipboard.writeText(rawContent).catch((err) => {
          console.error('[secure-viewer] Copy failed:', err);
        });
        break;
      }
      case 'sv-close': {
        options?.onClose?.();
        break;
      }
      case 'sv-ready': {
        // Outer iframe is ready — send content now
        const html = contentToHtml(rawContent, currentType);
        outerFrame.contentWindow?.postMessage(
          { type: 'sv-set-content', viewerId, html },
          '*',
        );
        break;
      }
    }
  };

  window.addEventListener('message', messageHandler);

  container.appendChild(outerFrame);

  const viewer: SecureViewer = {
    setContent(newContent: string, newType?: SecureViewerOptions['type']) {
      rawContent = newContent;
      if (newType) currentType = newType;
      const html = contentToHtml(rawContent, currentType);
      outerFrame.contentWindow?.postMessage(
        { type: 'sv-set-content', viewerId, html },
        '*',
      );
    },
    destroy() {
      window.removeEventListener('message', messageHandler);
      outerFrame.remove();
    },
  };

  return viewer;
}
