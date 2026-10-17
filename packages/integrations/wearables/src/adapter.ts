import type { CanonicalWriteIntent } from "@openvalens/ingestion";

/**
 * Cloud wearable adapter contract (Issue #60).
 *
 * Phone-first: HealthKit and Health Connect already bring steps, heart rate,
 * sleep and workouts from most wearables with no vendor account. A cloud
 * adapter exists only for what the phone cannot carry (overnight HRV and the
 * vendor's own scores) and for people without the phone companion. Each
 * adapter is one plain-`fetch` module in `src/providers/<id>.ts`, built from
 * the self-hoster's own developer-app credentials, and is the only code that
 * knows a vendor's URLs and payload shapes. Everything else (token storage,
 * refresh locking, sync windows, dedupe, disconnect) lives in `service.ts`.
 *
 * Adapters never log; they throw {@link WearableProviderError}, whose message
 * and summary carry no payload, token or health value.
 */

export const WEARABLE_PROVIDER_IDS = [
  "oura",
  "whoop",
  "polar",
  "withings",
  "google_health",
] as const;

export type WearableProviderId = (typeof WEARABLE_PROVIDER_IDS)[number];

export function isWearableProviderId(value: unknown): value is WearableProviderId {
  return typeof value === "string" && (WEARABLE_PROVIDER_IDS as readonly string[]).includes(value);
}

export type WearableTokenSet = {
  accessToken: string;
  /** `null` for vendors whose tokens do not expire (Polar). */
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  /** The vendor's user id when the token response carries it. */
  externalUserId: string | null;
};

export type SyncWindow = { from: Date; to: Date };

/** What a verified webhook delivery asks the service to do. Never carries health values. */
export type WearableWebhookEvent =
  /** New or changed data for this vendor user: schedule a sync. */
  | { kind: "data_changed"; externalUserId: string }
  /** The vendor deleted one record (`*.deleted`): hide that record's rows. */
  | { kind: "record_deleted"; externalUserId: string; externalRecordId: string }
  /** The person revoked access at the vendor: quarantine the connection's rows. */
  | { kind: "deauthorized"; externalUserId: string };

export type WebhookRequest = { headers: Headers; rawBody: string; now: Date };

export interface WearableAdapter {
  readonly id: WearableProviderId;
  /** Space-separated scopes requested at authorization. */
  readonly scopes: string;
  /** `false` when the vendor issues non-expiring tokens and no refresh endpoint (Polar). */
  readonly refreshes: boolean;
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<WearableTokenSet>;
  refresh(refreshToken: string): Promise<WearableTokenSet>;
  /** The vendor's stable user id for a fresh token (profile call when the token lacks it). */
  identify(token: WearableTokenSet): Promise<string>;
  /** Post-connect setup: Polar user registration, Withings notification subscription. */
  onConnected?(input: {
    accessToken: string;
    externalUserId: string;
    webhookUrl: string | null;
  }): Promise<void>;
  /** Records in the window, mapped to canonical write intents. */
  fetchRecords(input: {
    accessToken: string;
    externalUserId: string;
    window: SyncWindow;
  }): Promise<CanonicalWriteIntent[]>;
  /** Revoke the grant upstream (Polar de-registers the user). */
  revoke(input: {
    accessToken: string;
    refreshToken: string | null;
    externalUserId: string;
  }): Promise<void>;
  /**
   * Verify and parse a webhook delivery. Throws {@link WearableWebhookRejected}
   * on a bad signature; returns `[]` for events it ignores. Absent when the
   * vendor has no webhooks the adapter uses (polling only).
   */
  parseWebhook?(request: WebhookRequest): WearableWebhookEvent[];
}

// ─── Errors ──────────────────────────────────────────────────────

/**
 * Failure category, mirroring the email and push families:
 * `network`, `timeout`, `rate_limited`, `provider_unavailable` (retryable) and
 * `reauthorization_required` (the grant is gone: the person must reconnect),
 * `auth`, `rejected`, `invalid_response` (not retryable).
 */
export type WearableErrorCategory =
  | "network"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "reauthorization_required"
  | "auth"
  | "rejected"
  | "invalid_response";

const RETRYABLE = new Set<WearableErrorCategory>([
  "network",
  "timeout",
  "rate_limited",
  "provider_unavailable",
]);

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** Keeps only identifier-shaped vendor error codes (`invalid_grant`). */
export function sanitizeProviderErrorName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_NAME.test(trimmed) ? trimmed : null;
}

export class WearableProviderError extends Error {
  readonly code = "WEARABLE_PROVIDER";
  readonly provider: WearableProviderId;
  readonly status: number;
  readonly category: WearableErrorCategory;
  readonly retryable: boolean;
  readonly providerError: string | null;

  constructor(
    provider: WearableProviderId,
    category: WearableErrorCategory,
    status = 0,
    providerError?: string | null,
  ) {
    const safe = sanitizeProviderErrorName(providerError);
    super(`Wearable provider ${provider} failed (${category}, status ${status})`);
    this.name = "WearableProviderError";
    this.provider = provider;
    this.status = status;
    this.category = category;
    this.retryable = RETRYABLE.has(category);
    this.providerError = safe;
  }
}

/** A webhook delivery whose signature or shape did not verify. */
export class WearableWebhookRejected extends Error {
  readonly reason: "signature" | "malformed";
  constructor(reason: "signature" | "malformed") {
    super(`Wearable webhook rejected (${reason})`);
    this.name = "WearableWebhookRejected";
    this.reason = reason;
  }
}

export type WearableErrorSummary = {
  errorCode: "WEARABLE_PROVIDER" | "WEARABLE_UNKNOWN";
  errorCategory: WearableErrorCategory | "unknown";
  retryable: boolean;
  provider?: WearableProviderId;
  status?: number;
  providerError?: string;
};

/** Value-free summary of any thrown failure, safe for a structured log. */
export function describeWearableError(error: unknown): WearableErrorSummary {
  if (error instanceof WearableProviderError)
    return {
      errorCode: error.code,
      errorCategory: error.category,
      retryable: error.retryable,
      provider: error.provider,
      status: error.status,
      ...(error.providerError ? { providerError: error.providerError } : {}),
    };
  return { errorCode: "WEARABLE_UNKNOWN", errorCategory: "unknown", retryable: false };
}

// ─── HTTP ────────────────────────────────────────────────────────

export type WearableHttpDeps = {
  fetch: typeof fetch;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
};

/** Vendor base URLs; tests point every one at a local mock server. */
export type WearableEndpoints<K extends string> = Readonly<Record<K, string>>;

function categorizeStatus(status: number): WearableErrorCategory {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 401 || status === 403) return "auth";
  return "rejected";
}

/** OAuth error codes meaning the grant is gone and only a reconnect helps. */
const GRANT_GONE = new Set(["invalid_grant", "invalid_token", "unauthorized_client"]);

/**
 * One HTTP call to a vendor. Returns the parsed JSON body (or `null` for an
 * empty body). Maps transport failures and non-2xx statuses to
 * {@link WearableProviderError}; with `oauth: true`, an `invalid_grant`-style
 * answer becomes `reauthorization_required`. Only the vendor's `error` code is
 * kept, never its message or body.
 */
export async function requestJson(
  deps: WearableHttpDeps,
  provider: WearableProviderId,
  url: string,
  init: RequestInit & { oauth?: boolean } = {},
): Promise<unknown> {
  const { oauth, ...requestInit } = init;
  let response: Response;
  try {
    response = await deps.fetch(url, {
      ...requestInit,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new WearableProviderError(
      provider,
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    );
  }
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok)
        throw new WearableProviderError(provider, "invalid_response", response.status);
    }
  }
  if (!response.ok) {
    const errorName =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: unknown }).error
        : null;
    const safe = sanitizeProviderErrorName(errorName);
    const category =
      oauth && (response.status === 400 || response.status === 401) && safe && GRANT_GONE.has(safe)
        ? "reauthorization_required"
        : categorizeStatus(response.status);
    throw new WearableProviderError(provider, category, response.status, safe);
  }
  return body;
}

export function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ─── Payload helpers ─────────────────────────────────────────────

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/** Any parseable timestamp (with offset) → canonical UTC ISO, else `null`. */
export function utcIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `YYYY-MM-DD` of a date in UTC. */
export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Token lifetime in seconds → absolute expiry, or `null`. */
export function expiresIn(seconds: unknown, now = Date.now()): Date | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? new Date(now + seconds * 1000)
    : null;
}

/**
 * Standard OAuth token response (`access_token`, `refresh_token`,
 * `expires_in`, `scope`). Throws `invalid_response` without an access token.
 */
export function parseTokenResponse(
  provider: WearableProviderId,
  body: unknown,
  externalUserIdKey?: string,
): WearableTokenSet {
  const record = asRecord(body);
  const accessToken = record ? str(record, "access_token") : null;
  if (!record || !accessToken) throw new WearableProviderError(provider, "invalid_response", 200);
  return {
    accessToken,
    refreshToken: str(record, "refresh_token"),
    expiresAt: expiresIn(record.expires_in),
    scope: str(record, "scope"),
    externalUserId: externalUserIdKey ? str(record, externalUserIdKey) : null,
  };
}
