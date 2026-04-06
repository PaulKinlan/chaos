#!/bin/bash
# Pre-commit security review hook for Claude Code
# Runs before git commit commands to check for security issues

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Get the staged diff
DIFF=$(git diff --cached --no-color 2>/dev/null || echo "")

if [ -z "$DIFF" ]; then
  exit 0
fi

ISSUES=""

# Check for hardcoded secrets/tokens
if echo "$DIFF" | grep -iE '(api[_-]?key|secret|token|password|credential)\s*[:=]\s*["\x27][A-Za-z0-9+/=_-]{20,}' | grep -v '^\+.*placeholder\|^\+.*example\|^\+.*test\|^\+.*mock\|^\+.*TODO' | head -5; then
  ISSUES="${ISSUES}\n- Possible hardcoded secrets detected in staged changes"
fi

# Check for eval/Function usage (CSP issues in extensions)
if echo "$DIFF" | grep -E '^\+.*\beval\s*\(' | grep -v '^\+.*//\|^\+.*/\*\|wasm-unsafe-eval\|test' | head -5; then
  ISSUES="${ISSUES}\n- eval() usage detected (blocked by extension CSP)"
fi

# Check for alert/confirm/prompt (UI guidelines)
if echo "$DIFF" | grep -E '^\+.*\b(alert|confirm|prompt)\s*\(' | grep -v '^\+.*//\|^\+.*/\*\|^\+.*test\|channelLog' | head -5; then
  ISSUES="${ISSUES}\n- alert()/confirm()/prompt() usage detected (use dialog elements instead)"
fi

# Check for console.log left in (not console.error/warn/info)
# Only flag if many are added (a few for debugging is fine)
LOG_COUNT=$(echo "$DIFF" | grep -c '^\+.*console\.log(' 2>/dev/null || echo "0")
if [ "$LOG_COUNT" -gt 10 ]; then
  ISSUES="${ISSUES}\n- $LOG_COUNT console.log() statements added (consider using structured logging)"
fi

# Check for innerHTML without escapeHtml
if echo "$DIFF" | grep -E '^\+.*innerHTML\s*=' | grep -v 'escapeHtml\|sanitize\|DOMPurify\|test' | head -3; then
  ISSUES="${ISSUES}\n- innerHTML assignment without escapeHtml() detected (XSS risk)"
fi

# Check for dynamic import in background.ts
if echo "$DIFF" | grep -E '^\+.*await import\(' | grep 'background\.ts' | head -3; then
  ISSUES="${ISSUES}\n- Dynamic import() in service worker detected (not allowed in MV3)"
fi

if [ -n "$ISSUES" ]; then
  echo "Security review found potential issues:" >&2
  echo -e "$ISSUES" >&2
  echo "" >&2
  echo "Review these before committing. If they are false positives, proceed." >&2
  # Exit 0 to warn but not block (exit 2 would block)
  exit 0
fi

exit 0
