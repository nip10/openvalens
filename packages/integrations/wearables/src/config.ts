import type { IntegrationStatus } from "@openvalens/config/integrations";

import type { WearableAdapter, WearableHttpDeps, WearableProviderId } from "./adapter";
import { createGoogleHealthAdapter } from "./providers/google-health";
import { createOuraAdapter } from "./providers/oura";
import { createPolarAdapter } from "./providers/polar";
import { createWhoopAdapter } from "./providers/whoop";
import { createWithingsAdapter } from "./providers/withings";

/**
 * `wearables` integration family (Issue #60).
 *
 * Phone-first ingestion (HealthKit / Health Connect through the companion
 * app) is always on and needs no vendor account. Each cloud adapter is off
 * until the self-hoster sets their own developer app's client id and secret;
 * Google Health additionally needs `WEARABLES_GOOGLE_HEALTH_ENABLED=true`
 * while its API is in preview. A partial set (an id without its secret) keeps
 * that vendor off and reports the missing key *names* only.
 */

export type WearablesEnv = {
  WEARABLES_WEBHOOKS?: boolean | string | null;
  WEARABLES_OURA_CLIENT_ID?: string | null;
  WEARABLES_OURA_CLIENT_SECRET?: string | null;
  WEARABLES_WHOOP_CLIENT_ID?: string | null;
  WEARABLES_WHOOP_CLIENT_SECRET?: string | null;
  WEARABLES_POLAR_CLIENT_ID?: string | null;
  WEARABLES_POLAR_CLIENT_SECRET?: string | null;
  WEARABLES_POLAR_WEBHOOK_SECRET?: string | null;
  WEARABLES_WITHINGS_CLIENT_ID?: string | null;
  WEARABLES_WITHINGS_CLIENT_SECRET?: string | null;
  WEARABLES_GOOGLE_HEALTH_ENABLED?: boolean | string | null;
  WEARABLES_GOOGLE_HEALTH_CLIENT_ID?: string | null;
  WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET?: string | null;
};

export type WearableClientCredentials = {
  clientId: string;
  clientSecret: string;
  /** Polar only: the webhook `signature_secret_key`. */
  webhookSecret: string | null;
};

export type WearablesConfig = {
  readonly providers: Readonly<Partial<Record<WearableProviderId, WearableClientCredentials>>>;
  /** Register vendor notification callbacks on connect (needs public HTTPS ingress). */
  readonly webhooks: boolean;
  /** Names of keys that would complete a half-configured vendor. Never values. */
  readonly missingKeys: readonly string[];
};

/** User-facing catalog: one line on what each vendor sends, and its terms. */
export const WEARABLE_PROVIDER_INFO: Readonly<
  Record<WearableProviderId, { displayName: string; sends: string; termsUrl: string }>
> = Object.freeze({
  oura: {
    displayName: "Oura",
    sends: "Readiness score, overnight HRV, resting heart rate, sleep sessions and daily steps.",
    termsUrl: "https://ouraring.com/terms-and-conditions",
  },
  whoop: {
    displayName: "WHOOP",
    sends: "Recovery score, overnight HRV, resting heart rate and sleep sessions.",
    termsUrl: "https://www.whoop.com/us/en/terms-of-use/",
  },
  polar: {
    displayName: "Polar",
    sends: "Nightly Recharge status, overnight HRV and sleep sessions.",
    termsUrl: "https://www.polar.com/en/legal/terms-of-use",
  },
  withings: {
    displayName: "Withings",
    sends: "Weight, body fat and sleep sessions.",
    termsUrl: "https://www.withings.com/legal/terms-of-use",
  },
  google_health: {
    displayName: "Google Health",
    sends: "Daily steps, weight, resting heart rate, daily HRV and sleep sessions.",
    termsUrl: "https://developers.google.com/health/policies/health-api-developer-user-data-policy",
  },
});

const PREFIX: Record<WearableProviderId, string> = {
  oura: "WEARABLES_OURA",
  whoop: "WEARABLES_WHOOP",
  polar: "WEARABLES_POLAR",
  withings: "WEARABLES_WITHINGS",
  google_health: "WEARABLES_GOOGLE_HEALTH",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function flag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

/** Pure: validates an explicit env object; never reads `process.env`. */
export function parseWearablesConfig(env: WearablesEnv): WearablesConfig {
  const values = env as Record<string, unknown>;
  const providers: Partial<Record<WearableProviderId, WearableClientCredentials>> = {};
  const missingKeys: string[] = [];
  for (const [provider, prefix] of Object.entries(PREFIX) as [WearableProviderId, string][]) {
    const clientId = text(values[`${prefix}_CLIENT_ID`]);
    const clientSecret = text(values[`${prefix}_CLIENT_SECRET`]);
    if (provider === "google_health" && !flag(env.WEARABLES_GOOGLE_HEALTH_ENABLED)) continue;
    if (clientId && clientSecret) {
      providers[provider] = {
        clientId,
        clientSecret,
        webhookSecret: provider === "polar" ? text(env.WEARABLES_POLAR_WEBHOOK_SECRET) : null,
      };
    } else if (clientId || clientSecret || provider === "google_health") {
      if (!clientId) missingKeys.push(`${prefix}_CLIENT_ID`);
      if (!clientSecret) missingKeys.push(`${prefix}_CLIENT_SECRET`);
    }
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    webhooks: flag(env.WEARABLES_WEBHOOKS),
    missingKeys: Object.freeze(missingKeys),
  });
}

export const WEARABLE_INTEGRATION_KEYS: Readonly<Record<WearableProviderId, string>> = {
  oura: "wearablesOura",
  whoop: "wearablesWhoop",
  polar: "wearablesPolar",
  withings: "wearablesWithings",
  google_health: "wearablesGoogleHealth",
};

/**
 * One readiness entry per cloud vendor (`wearablesOura`, …), each `off`
 * unless configured. Phone-first ingestion needs no entry: it is always on.
 */
export function describeWearablesIntegrations(
  config: WearablesConfig,
): Record<string, IntegrationStatus<WearableProviderId>> {
  const statuses: Record<string, IntegrationStatus<WearableProviderId>> = {};
  for (const [provider, key] of Object.entries(WEARABLE_INTEGRATION_KEYS) as [
    WearableProviderId,
    string,
  ][])
    statuses[key] = config.providers[provider]
      ? { provider, state: "configured" }
      : { provider: null, state: "off" };
  return statuses;
}

/** Builds the configured adapters (none by default). */
export function createWearableAdapters(
  config: WearablesConfig,
  deps: WearableHttpDeps,
): Partial<Record<WearableProviderId, WearableAdapter>> {
  const adapters: Partial<Record<WearableProviderId, WearableAdapter>> = {};
  const { oura, whoop, polar, withings, google_health } = config.providers;
  if (oura) adapters.oura = createOuraAdapter(oura, deps);
  if (whoop) adapters.whoop = createWhoopAdapter(whoop, deps);
  if (polar) adapters.polar = createPolarAdapter(polar, deps);
  if (withings) adapters.withings = createWithingsAdapter(withings, deps);
  if (google_health) adapters.google_health = createGoogleHealthAdapter(google_health, deps);
  return adapters;
}
