# Plan: Rich Artifacts, Secure Preview, and Proactive Dashboard

## Status

**Audited 2026-04-07**

- Phase 1 (Secure Content Renderer): DONE — `src/ui/secure-viewer.ts`
- Phase 2 (Rich Artifact Viewer): DONE — `<chaos-artifact-detail>` shared component
- Phase 3 (Proactive Artifact Creation): DONE
- Phase 4 (Proactive Dashboard): DONE — `<chaos-dashboard-view>` with suggestions, pinned artifacts, activity stats
- Phase 5 (Advanced Artifact Types): TODO — PDF, CSV table, JSON tree, image preview, SVG rendering

---

## Problem

1. **Artifacts are underused** — agents mostly write to memory files which users never look at. Artifacts exist but agents don't proactively create them. The daily review writes to memory, not artifacts.

2. **Artifacts are hard to view** — shown as raw text/HTML in a modal. Can't preview generated web pages, PDFs, or rich content.

3. **No proactive surface** — there's nowhere that shows "here's what happened" or "here's what you could do next" based on agent activity. Users have to actively ask agents or browse memory files.

## Goals

1. Agents should proactively produce artifacts (summaries, reports, generated pages) not just memory updates
2. Artifacts should render in a secure sandboxed iframe — HTML pages viewable as actual pages, PDFs viewable inline
3. A "double iframe" pattern for secure content rendering, reusable across the extension
4. A proactive dashboard/view showing suggestions, recent activity summaries, and next steps
5. Default scheduled tasks should produce artifacts alongside memory updates

## Architecture

### 1. Secure Content Renderer (Double Iframe)

The "double iframe" pattern creates a security boundary for rendering untrusted content:

```
Extension page (app.html)
  └── Outer iframe (srcdoc, sandbox="allow-scripts")
        └── Inner iframe (srcdoc, sandbox="")
              └── Rendered content (HTML, markdown)
```

Why double iframe:
- Inner iframe has NO permissions (sandbox="") — no scripts, no forms, no navigation
- Outer iframe can add a control bar (zoom, download, print) and handle messages
- Content cannot access the extension's DOM, storage, or APIs
- Content cannot navigate the parent frame
- Safe to render any agent-generated HTML, SVG, or markdown

```typescript
// Reusable component
function createSecureViewer(container: HTMLElement, content: string, options?: {
  type?: 'html' | 'markdown' | 'pdf' | 'text';
  title?: string;
  downloadFilename?: string;
}): SecureViewer;

interface SecureViewer {
  setContent(content: string, type?: string): void;
  destroy(): void;
}
```

### 2. Rich Artifact Types

Expand artifacts beyond plain text:

```typescript
interface ArtifactMeta {
  agentId: string;
  path: string;
  description: string;
  timestamp: string;
  // New fields:
  type?: 'text' | 'html' | 'markdown' | 'pdf' | 'csv' | 'json' | 'image' | 'webpage';
  title?: string;
  preview?: boolean; // true = show in viewer, false = download only
  pinned?: boolean;  // true = show on dashboard
  tags?: string[];   // for filtering/search
}
```

### 3. Artifact Viewer in UI

Replace the current raw-text artifact modal with a proper viewer:

- **Text/Markdown**: rendered with marked + DOMPurify in secure iframe
- **HTML/Webpage**: rendered as actual web page in secure double iframe
- **PDF**: shown in embedded PDF viewer (iframe with pdf URL or pdf.js)
- **CSV/JSON**: rendered as formatted table
- **Image**: shown inline

The artifact detail view gets:
- Preview pane (secure iframe)
- Copy button (existing)
- Download button
- Pin/unpin toggle
- Delete button
- Metadata (agent, timestamp, tags)

### 4. Proactive Artifact Creation

Update the default scheduled task prompt to instruct the agent to publish artifacts:

Current prompt: "Daily review: Read through your memories/..."
New prompt should include: "Publish a daily summary artifact with the key findings, pending items, and suggestions."

Also update the master agent template to encourage artifact creation:
- "When you complete a research task, publish the results as an artifact so the user can read them later"
- "When summarising content, publish the summary as an artifact, not just a memory file"
- "Use artifact_publish for anything the user might want to come back to"

### 5. Proactive Dashboard View

A new sidebar view (or section within the chat view) showing:

```
┌─────────────────────────────────────────┐
│  Dashboard                              │
│                                         │
│  ── Today ──                            │
│  📊 Daily Summary (pinned artifact)     │
│     "3 tasks completed, 2 pending..."   │
│     [View] [Chat about this]            │
│                                         │
│  ── Suggestions ──                      │
│  💡 "You bookmarked 5 articles about    │
│      React — want me to summarise       │
│      them into a comparison?"           │
│      [Do it] [Dismiss]                  │
│                                         │
│  💡 "Your TODO list has 3 items older   │
│      than a week — want to review?"     │
│      [Review] [Dismiss]                 │
│                                         │
│  ── Recent Artifacts ──                 │
│  📄 Flight price comparison (2h ago)    │
│  📄 Meeting notes summary (yesterday)   │
│  📊 Weekly usage report (3 days ago)    │
│                                         │
│  ── Activity ──                         │
│  • Hook "summarize bookmarks" ran 3x    │
│  • Agent "Researcher" completed 2 tasks │
│  • 147 tokens used ($0.04)              │
└─────────────────────────────────────────┘
```

#### How suggestions work

Suggestions are generated by the daily review task (or a separate scheduled task):
1. Agent reviews activity log, memory files, hooks, usage
2. Identifies patterns, stale items, opportunities
3. Publishes suggestions as a special artifact type
4. Dashboard reads and displays them

```typescript
interface Suggestion {
  id: string;
  title: string;
  description: string;
  action: {
    type: 'chat' | 'hook' | 'dismiss';
    prompt?: string;  // for chat: the prompt to send
    hookConfig?: Partial<Hook>;  // for hook: create this hook
  };
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  dismissedAt?: string;
}
```

## Implementation Phases

### Phase 1: Secure Content Renderer

1. Create `src/ui/secure-viewer.ts` — the double iframe component
2. Supports HTML, markdown (via marked), and plain text
3. Control bar: title, download, copy, close
4. Used in artifact detail modal first
5. Test with various content types
6. **Deliverable**: secure, reusable content renderer

### Phase 2: Rich Artifact Viewer

1. Expand ArtifactMeta with type, title, preview, pinned, tags
2. Replace artifact detail modal with secure viewer
3. Add type detection (HTML, markdown, text, JSON, CSV)
4. Add download button + filename
5. Artifact list shows type badges and preview thumbnails
6. **Deliverable**: artifacts render beautifully by type

### Phase 3: Proactive Artifact Creation

1. Update daily review prompt to produce artifacts
2. Update master template to encourage artifact_publish
3. Add "pin artifact" concept (pinned = shows on dashboard)
4. Ensure hook results can be published as artifacts
5. **Deliverable**: agents proactively create viewable artifacts

### Phase 4: Proactive Dashboard

1. New sidebar view: "Dashboard" (or add to existing chat view)
2. Shows: pinned artifacts, recent artifacts, activity summary
3. Suggestions section with [Do it] / [Dismiss] actions
4. Suggestion generation via scheduled task or daily review
5. Clicking "Do it" sends the suggestion prompt to the agent
6. **Deliverable**: proactive, actionable dashboard

### Phase 5: Advanced Artifact Types

1. PDF rendering (pdf.js or native browser PDF viewer)
2. CSV → table renderer
3. JSON → formatted tree viewer
4. Image preview
5. SVG rendering (in secure iframe)
6. **Deliverable**: comprehensive artifact type support

## Double Iframe Implementation Detail

```typescript
function createSecureViewer(container: HTMLElement, content: string, options?: {
  type?: string;
  title?: string;
}): { setContent: (c: string) => void; destroy: () => void } {
  // Outer iframe: provides control bar and security boundary
  const outerFrame = document.createElement('iframe');
  outerFrame.sandbox = 'allow-scripts'; // outer can run scripts for controls
  outerFrame.style.cssText = 'width:100%;height:100%;border:none;';

  const outerDoc = `
    <!DOCTYPE html>
    <html><head>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: system-ui; }
        .toolbar { padding:8px; background:#1a1a2e; display:flex; gap:8px; align-items:center; }
        .toolbar button { background:none; border:1px solid #444; color:#ccc; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px; }
        .toolbar .title { flex:1; color:#e1e4e8; font-size:13px; font-weight:500; }
        .content-frame { width:100%; height:calc(100% - 40px); border:none; }
      </style>
    </head><body>
      <div class="toolbar">
        <span class="title">${title}</span>
        <button onclick="download()">Download</button>
        <button onclick="copy()">Copy</button>
      </div>
      <!-- Inner iframe: NO permissions at all -->
      <iframe class="content-frame" sandbox="" srcdoc=""></iframe>
      <script>
        function setContent(html) {
          document.querySelector('.content-frame').srcdoc = html;
        }
        function download() { /* post message to parent */ }
        function copy() { /* post message to parent */ }
        // Listen for content updates from parent
        window.addEventListener('message', (e) => {
          if (e.data.type === 'setContent') setContent(e.data.html);
        });
      </script>
    </body></html>
  `;

  outerFrame.srcdoc = outerDoc;
  container.appendChild(outerFrame);

  return {
    setContent(html: string) {
      outerFrame.contentWindow?.postMessage({ type: 'setContent', html }, '*');
    },
    destroy() {
      outerFrame.remove();
    },
  };
}
```

## Open Questions

1. **Should suggestions persist?** Currently agents write to memory files. Suggestions could be a special file in `suggestions/` that the dashboard reads. Or a dedicated store.

2. **Artifact storage limits?** Large HTML pages or PDFs could use significant OPFS space. Should we limit artifact size or count?

3. **Artifact sharing?** Could artifacts be shared via URL? Would need a relay endpoint for this.

4. **Dashboard vs. new tab page?** Should the dashboard replace the chat as the default view, or be a separate sidebar item? The smart start screen already serves as a one-time dashboard — this would be the persistent version.

5. **Should the double iframe component be in the SDK?** It's browser-specific but any web-based UI would want it. Maybe `@chaos/sdk/ui` or a separate `@chaos/ui` package.
