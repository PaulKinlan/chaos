// Content sanitization for relay server messages
// Strips HTML, enforces size limits

const MAX_CONTENT_SIZE = 64 * 1024;   // 64KB
const MAX_METADATA_SIZE = 4 * 1024;   // 4KB

// Simple HTML tag stripping regex — removes all HTML tags
const HTML_TAG_RE = /<[^>]*>/g;

/**
 * Strip HTML tags from a string
 */
export function stripHtml(input: string): string {
  return input.replace(HTML_TAG_RE, '');
}

/**
 * Sanitize message content: strip HTML and enforce size limit.
 * Returns the sanitized content, or null if the content exceeds the size limit
 * after sanitization (shouldn't happen, but guards against edge cases).
 */
export function sanitizeContent(content: string): { content: string; truncated: boolean } {
  let sanitized = stripHtml(content);
  let truncated = false;

  if (sanitized.length > MAX_CONTENT_SIZE) {
    sanitized = sanitized.slice(0, MAX_CONTENT_SIZE);
    truncated = true;
  }

  return { content: sanitized, truncated };
}

/**
 * Validate metadata size. Returns true if within limits.
 */
export function isMetadataWithinLimits(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return true;
  const serialized = JSON.stringify(metadata);
  return serialized.length <= MAX_METADATA_SIZE;
}

/**
 * Sanitize a full incoming message payload.
 * Returns sanitized content and whether the message is valid.
 */
export function sanitizeMessage(content: string, metadata?: Record<string, unknown>): {
  valid: boolean;
  content: string;
  error?: string;
} {
  if (!content || typeof content !== 'string') {
    return { valid: false, content: '', error: 'Missing or invalid content' };
  }

  if (content.length > MAX_CONTENT_SIZE * 2) {
    // Reject obviously oversized payloads before processing
    return { valid: false, content: '', error: `Content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes` };
  }

  const { content: sanitized } = sanitizeContent(content);

  if (metadata && !isMetadataWithinLimits(metadata)) {
    return { valid: false, content: sanitized, error: `Metadata exceeds maximum size of ${MAX_METADATA_SIZE} bytes` };
  }

  return { valid: true, content: sanitized };
}
