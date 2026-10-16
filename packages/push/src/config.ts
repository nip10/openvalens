import type { IntegrationStatus } from "@openvalens/config/integrations";

import type { PushProvider } from "./provider";
import { createExpoPushProvider } from "./providers/expo";

/**
 * `push` integration family (Issue #92). Off by default: with no
 * `PUSH_PROVIDER` the server boots, readiness reports `push: off`, and push
 * opt-ins are shown as unavailable. `PUSH_PROVIDER=expo` uses the Expo push
 * service, which needs no server credential.
 */

export const PUSH_PROVIDERS = ["expo"] as const;
export type PushProviderId = (typeof PUSH_PROVIDERS)[number];

export type PushConfig = { provider: PushProviderId | null };

/** Pure: validates an explicit env object; never reads `process.env`. */
export function parsePushConfig(env: { PUSH_PROVIDER?: string | null | undefined }): PushConfig {
  const raw = env.PUSH_PROVIDER?.trim().toLowerCase();
  return { provider: raw === "expo" ? "expo" : null };
}

export function describePushIntegration(config: PushConfig): IntegrationStatus<PushProviderId> {
  return config.provider === null
    ? { provider: null, state: "off" }
    : { provider: config.provider, state: "configured" };
}

/** Builds the configured adapter, or `null` when push is off. */
export function createPushProvider(
  config: PushConfig,
  deps: { fetch: typeof fetch },
): PushProvider | null {
  return config.provider === "expo" ? createExpoPushProvider({ fetch: deps.fetch }) : null;
}
