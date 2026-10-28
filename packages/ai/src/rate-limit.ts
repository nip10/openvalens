/**
 * In-memory AI rate limiter (Issue #13).
 *
 * A sliding-window limiter keyed by an opaque string (the API layer uses
 * `` `${userId}:${organizationId}` ``). Ported in spirit from
 * `anchovy/apps/web/src/lib/ai/{chat-rate-limit,rate-limit}.ts`, but modelled
 * as a reusable class with an injectable clock so tests are deterministic.
 *
 * This is process-local state: it resets on restart and is not shared across
 * replicas. TODO(#13-rate-limit): swap for Redis so limits are global.
 */

export type RateLimitDecision = {
  allowed: boolean;
  /** Milliseconds until the oldest in-window hit ages out. Only set when denied. */
  retryAfterMs?: number;
};

export type InMemoryRateLimiterOptions = {
  /** Maximum allowed hits per window. Must be a positive integer. */
  limitPerMinute: number;
  /** Clock injection for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Window length. Defaults to 60 seconds. */
  windowMs?: number;
};

const DEFAULT_WINDOW_MS = 60_000;

export class InMemoryRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: InMemoryRateLimiterOptions) {
    if (!Number.isInteger(options.limitPerMinute) || options.limitPerMinute <= 0) {
      throw new Error("InMemoryRateLimiter: limitPerMinute must be a positive integer.");
    }
    this.limit = options.limitPerMinute;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records a hit against `key` and reports whether it is allowed.
   *
   * A denied hit is **not** recorded, so a client that keeps retrying does not
   * extend its own lockout.
   */
  check(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] as number;
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  /**
   * Drops every key with no hit inside the current window. A limiter keyed by
   * caller-controlled values (an IP, an email digest) calls this periodically
   * so its memory stays bounded by recent traffic, not by every key ever seen.
   */
  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, hits] of this.hits) {
      if (hits.length === 0 || (hits.at(-1) as number) <= cutoff) this.hits.delete(key);
    }
  }

  /** Number of keys currently tracked (for tests and bounded-memory checks). */
  get size(): number {
    return this.hits.size;
  }

  /** Clears state for one key, or all keys when `key` is omitted. */
  reset(key?: string): void {
    if (typeof key === "undefined") {
      this.hits.clear();
      return;
    }
    this.hits.delete(key);
  }
}
