import type { IntegrationStatus } from "@openvalens/config/integrations";

import type { OffLookupResult } from "./catalog/off-client";
import { createOpenFoodFactsLookup } from "./providers/openfoodfacts";

/**
 * Live single-product barcode lookup (Issue #69), the `foodLookup`
 * integration family (#57 contract).
 *
 * Off by default: a self-hosted install answers barcode lookups from the
 * user's private custom foods and the imported catalog mirrors (#72) only, and
 * manual diary use never needs a hosted API. An operator can opt in to a live
 * Open Food Facts lookup for codes the local sources miss, optionally through
 * a privacy proxy (`FOOD_LOOKUP_BASE_URL`). Only the product code and an
 * app-identifying User-Agent are ever sent; nothing is logged.
 */

export const FOOD_LOOKUP_PROVIDERS = ["openfoodfacts"] as const;
export type FoodLookupProviderId = (typeof FOOD_LOOKUP_PROVIDERS)[number];

export type FoodLookupConfig = {
  /** `null` when live lookup is off (the default). */
  provider: FoodLookupProviderId | null;
  /** App name/version and an operator contact, e.g. `OpenValens/1.0 (ops@example.org)`. */
  userAgent: string | null;
  /** Upstream or privacy-proxy origin; `null` uses the provider's public API. */
  baseUrl: string | null;
};

/** Raw env input accepted by {@link parseFoodLookupConfig}. */
export type FoodLookupEnv = Record<string, string | number | boolean | undefined | null>;

/** A live lookup adapter. Results never throw for upstream failures. */
export type FoodLookupProvider = {
  readonly provider: FoodLookupProviderId;
  /** Looks up one normalized (digits-only) product code. */
  lookup(code: string): Promise<OffLookupResult>;
};

export type FoodLookupDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
};

function readString(env: FoodLookupEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** OFF asks for `AppName/Version (contact)`; the client enforces the same shape. */
function isValidUserAgent(value: string): boolean {
  return /\S+\/\S+/.test(value) && /[@(]/.test(value);
}

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Pure config parse (never reads `process.env`). An unknown provider, a
 * missing/malformed User-Agent or a malformed base URL leaves the family
 * `off` instead of failing boot, so a misconfiguration can only remove the
 * optional live lookup, never manual logging.
 */
export function parseFoodLookupConfig(env: FoodLookupEnv): FoodLookupConfig {
  const provider = readString(env, "FOOD_LOOKUP_PROVIDER");
  const userAgent = readString(env, "FOOD_LOOKUP_USER_AGENT");
  const baseUrl = readString(env, "FOOD_LOOKUP_BASE_URL");
  const off: FoodLookupConfig = { provider: null, userAgent: null, baseUrl: null };
  if (provider !== "openfoodfacts") return off;
  if (!userAgent || !isValidUserAgent(userAgent)) return off;
  if (baseUrl !== null && !isValidBaseUrl(baseUrl)) return off;
  return { provider, userAgent, baseUrl: baseUrl?.replace(/\/+$/, "") ?? null };
}

/** Value-free readiness status (#57): provider id and state only. */
export function describeFoodLookupIntegration(
  config: FoodLookupConfig,
): IntegrationStatus<FoodLookupProviderId> {
  return config.provider === null
    ? { provider: null, state: "off" }
    : { provider: config.provider, state: "configured" };
}

/** Builds the configured adapter, or `null` when live lookup is off. */
export function createFoodLookup(
  config: FoodLookupConfig,
  deps: FoodLookupDeps,
): FoodLookupProvider | null {
  if (config.provider !== "openfoodfacts" || config.userAgent === null) return null;
  return createOpenFoodFactsLookup({
    fetch: deps.fetch,
    now: deps.now,
    userAgent: config.userAgent,
    baseUrl: config.baseUrl ?? undefined,
  });
}
