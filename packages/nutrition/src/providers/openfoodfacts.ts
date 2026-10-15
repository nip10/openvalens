import { createOffProductClient, type OffLookupResult } from "../catalog/off-client";
import type { FoodLookupProvider } from "../food-lookup";

/**
 * Open Food Facts live lookup adapter (Issue #69). Wraps the #72 product
 * client (code + User-Agent only, minimum request interval, typed failures)
 * with a small process-local cache so repeated scans of one product do not
 * re-query upstream.
 *
 * The cache stores the upstream record with its own `last_modified` version,
 * so a cached answer carries the same source/version attribution as a fresh
 * one; it is never presented as a freshness or quality signal. Failures
 * (`unavailable`) are never cached. Codes live only as in-memory keys and are
 * never logged.
 */

export type OpenFoodFactsLookupOptions = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  /** How long a found product is reused (default 6 h). */
  foundTtlMs?: number;
  /** How long a miss is reused (default 10 min), so a new product appears soon. */
  notFoundTtlMs?: number;
  /** Maximum cached codes (default 500); the oldest entry is evicted first. */
  maxEntries?: number;
  now?: () => number;
};

type CachedResult = Extract<OffLookupResult, { status: "found" | "not_found" }>;

export function createOpenFoodFactsLookup(options: OpenFoodFactsLookupOptions): FoodLookupProvider {
  const now = options.now ?? Date.now;
  const client = createOffProductClient({
    fetch: options.fetch,
    userAgent: options.userAgent,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    minIntervalMs: options.minIntervalMs,
    now,
  });
  const foundTtlMs = options.foundTtlMs ?? 6 * 60 * 60 * 1000;
  const notFoundTtlMs = options.notFoundTtlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 500;
  const cache = new Map<string, { result: CachedResult; expiresAt: number }>();

  return {
    provider: "openfoodfacts",
    async lookup(code) {
      const cached = cache.get(code);
      if (cached && cached.expiresAt > now()) return cached.result;
      if (cached) cache.delete(code);

      const result = await client.lookup(code);
      if (result.status === "unavailable") return result;
      cache.set(code, {
        result,
        expiresAt: now() + (result.status === "found" ? foundTtlMs : notFoundTtlMs),
      });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return result;
    },
  };
}
