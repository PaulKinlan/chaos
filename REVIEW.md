# Code Review Guidelines

## Security Review Checklist

### Extension (packages/extension/)
- [ ] No hardcoded API keys, tokens, or secrets
- [ ] No `eval()` or `new Function()` (blocked by MV3 CSP)
- [ ] No `alert()`, `confirm()`, `prompt()` — use `<dialog>` elements
- [ ] No `innerHTML` with unsanitized user input — use `escapeHtml()`
- [ ] No dynamic `import()` in background.ts (service worker)
- [ ] No `chrome.runtime.sendMessage` from service worker to itself
- [ ] No `setTimeout` in service worker for deferred execution
- [ ] Chrome permissions are optional where possible
- [ ] OPFS file paths are validated (no directory traversal)
- [ ] User data migrations are backwards compatible

### Relay Server (packages/server/)
- [ ] No credentials logged (API keys, bot tokens, passwords)
- [ ] Bot tokens encrypted at rest (AES-GCM)
- [ ] Rate limiting applied to all public endpoints
- [ ] Input sanitized (sanitizeMessage for reply content)
- [ ] CORS headers present on all responses
- [ ] WebSocket auth validated (token in query param)
- [ ] Nonce tracking prevents replay attacks
- [ ] Timestamp freshness checked (5-minute window)
- [ ] Channel allowlists enforced server-side
- [ ] Admin dashboard behind session cookie auth

### General
- [ ] No `.env` files or credentials committed
- [ ] TypeScript strict mode — no `any` types unless justified
- [ ] Error handling present (try/catch, not silent failures)
- [ ] Comprehensive logging at appropriate levels
- [ ] Tests pass (extension unit tests + relay conformance suite)

## Code Quality Checklist

### Architecture
- [ ] Changes follow existing patterns (tool registration, port messages, one-shot messages)
- [ ] New state stored in appropriate location (chrome.storage vs OPFS vs KV)
- [ ] No unnecessary global state
- [ ] New features have logging for debugging

### UI
- [ ] Uses CSS custom properties (--bg-base, --text-primary, etc.)
- [ ] Works in both light and dark themes
- [ ] Inline SVG icons, never emoji
- [ ] Responsive / doesn't break sidebar collapsed state
- [ ] No full-page re-renders for incremental state changes

### Relay Protocol
- [ ] OpenAPI spec (`docs/relay-openapi.yaml`) updated for endpoint changes
- [ ] Conformance tests updated for behaviour changes
- [ ] Backwards compatible (new fields optional, old clients still work)

## Review Process

1. **Self-review**: Read your own diff before committing
2. **Security scan**: The pre-commit hook runs automatically
3. **Build check**: `npm run build` must pass with validation
4. **Test check**: All tests must pass (unit + conformance)
5. **Doc check**: Update relevant docs (architecture, API, plans)
