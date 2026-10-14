import { NutritionError } from "../errors";
import { parseOffProduct } from "./off";
import type { OffProductRecord } from "./record";

/**
 * Open Food Facts single-product lookup (Issue #72), for real user scans
 * only; bulk data comes from the nightly dump through `importRelease`.
 *
 * Privacy: the request carries only the product code and an app-identifying
 * User-Agent (OFF requires one naming the app and a contact). No cookies,
 * credentials, referrer, user/tenant identity or client IP headers are sent,
 * and nothing is logged — the caller decides what (if anything) to record,
 * and must never record the code. Every failure is a typed, retry-aware
 * result instead of an exception, so a failed lookup never blocks manual
 * logging. A minimum interval between requests keeps us under OFF's
 * published read limits.
 */

export type OffLookupResult =
  | { status: "found"; record: OffProductRecord }
  | { status: "not_found" }
  | {
      status: "unavailable";
      reason: "timeout" | "rate_limited" | "upstream_error" | "invalid_response";
      /** Seconds to wait before retrying, when known. */
      retryAfterSeconds: number | null;
    };

export type OffClientOptions = {
  /** Injected for tests and proxies; never a global network call in tests. */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** e.g. `OpenValens/1.0 (ops@example.org)` — app name and a contact, no user data. */
  userAgent: string;
  /** Defaults to `https://world.openfoodfacts.org`; may point at a privacy proxy. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Minimum gap between upstream requests (default 600 ms ≈ 100/min). */
  minIntervalMs?: number;
  now?: () => number;
};

/** Only the fields the adapter maps; images and everything else are not requested. */
const FIELDS = [
  "code",
  "product_name",
  "brands",
  "last_modified_t",
  "nutriments",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "product_quantity_unit",
].join(",");

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function createOffProductClient(options: OffClientOptions) {
  const userAgent = options.userAgent.trim();
  if (!/\S+\/\S+/.test(userAgent) || !/[@(]/.test(userAgent))
    throw new NutritionError("INVALID_INPUT", "User-Agent must name the app/version and a contact");
  const baseUrl = (options.baseUrl ?? "https://world.openfoodfacts.org").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const minIntervalMs = options.minIntervalMs ?? 600;
  const now = options.now ?? Date.now;
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  return {
    /** Looks up one normalized product code (digits only). */
    async lookup(code: string): Promise<OffLookupResult> {
      if (!/^[0-9]{1,24}$/.test(code))
        throw new NutritionError("INVALID_INPUT", "Open Food Facts code must be digits");
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0)
        return {
          status: "unavailable",
          reason: "rate_limited",
          retryAfterSeconds: Math.ceil(wait / 1000),
        };
      lastRequestAt = now();

      let response: Response;
      try {
        response = await options.fetch(`${baseUrl}/api/v2/product/${code}.json?fields=${FIELDS}`, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": userAgent },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return {
          status: "unavailable",
          reason: timedOut ? "timeout" : "upstream_error",
          retryAfterSeconds: null,
        };
      }

      if (response.status === 404) return { status: "not_found" };
      if (response.status === 429 || response.status === 503)
        return {
          status: "unavailable",
          reason: "rate_limited",
          retryAfterSeconds: retryAfter(response),
        };
      if (!response.ok)
        return { status: "unavailable", reason: "upstream_error", retryAfterSeconds: null };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "unavailable", reason: "invalid_response", retryAfterSeconds: null };
      }
      const payload = body as { status?: unknown; product?: unknown } | null;
      if (payload?.status === 0 || payload?.product === undefined) return { status: "not_found" };
      const record = parseOffProduct(payload.product);
      if (!record || record.code !== code)
        return { status: "unavailable", reason: "invalid_response", retryAfterSeconds: null };
      return { status: "found", record };
    },
  };
}

export type OffProductClient = ReturnType<typeof createOffProductClient>;
