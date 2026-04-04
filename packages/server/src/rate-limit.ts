// Simple in-memory rate limiter for the relay server
// Tracks requests per key per sliding window

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up expired windows every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60_000);
  }

  /**
   * Check if a request is allowed under the rate limit.
   * Returns true if allowed, false if rate limited.
   *
   * @param key - The rate limit key (e.g. IP address, userId, channelId)
   * @param limit - Max requests allowed in the window
   * @param windowMs - Window duration in milliseconds
   */
  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now >= entry.resetAt) {
      // New window
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= limit) {
      return false; // rate limited
    }

    entry.count++;
    return true;
  }

  /**
   * Get remaining requests for a key. Returns -1 if no window exists.
   */
  remaining(key: string, limit: number): number {
    const entry = this.windows.get(key);
    if (!entry || Date.now() >= entry.resetAt) return limit;
    return Math.max(0, limit - entry.count);
  }

  /**
   * Get the reset time for a key (ms since epoch). Returns 0 if no window.
   */
  resetAt(key: string): number {
    const entry = this.windows.get(key);
    if (!entry || Date.now() >= entry.resetAt) return 0;
    return entry.resetAt;
  }

  /**
   * Remove expired window entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get the number of tracked windows (for testing)
   */
  get size(): number {
    return this.windows.size;
  }
}

// ── Rate limit configurations from security doc ──

export const RATE_LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 },           // 5/hour per IP
  messages: { limit: 120, windowMs: 60 * 1000 },               // 120/min per user
  reply: { limit: 30, windowMs: 60 * 1000 },                   // 30/min per user
  webhook: { limit: 60, windowMs: 60 * 1000 },                 // 60/min per channel
  channels: { limit: 10, windowMs: 60 * 60 * 1000 },           // 10/hour per user
} as const;
