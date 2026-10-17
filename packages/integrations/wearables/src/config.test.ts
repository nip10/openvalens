import { describe, expect, test } from "bun:test";

import {
  createWearableAdapters,
  describeWearablesIntegrations,
  parseWearablesConfig,
} from "./config";

describe("wearables config (Issue #60)", () => {
  test("no env: every vendor off, readiness reports each one off, no adapters", () => {
    const config = parseWearablesConfig({});
    expect(config).toEqual({ providers: {}, webhooks: false, missingKeys: [] });
    expect(describeWearablesIntegrations(config)).toEqual({
      wearablesOura: { provider: null, state: "off" },
      wearablesWhoop: { provider: null, state: "off" },
      wearablesPolar: { provider: null, state: "off" },
      wearablesWithings: { provider: null, state: "off" },
      wearablesGoogleHealth: { provider: null, state: "off" },
    });
    expect(createWearableAdapters(config, { fetch })).toEqual({});
  });

  test("a vendor is configured only with both id and secret; half sets name missing keys", () => {
    const config = parseWearablesConfig({
      WEARABLES_OURA_CLIENT_ID: "oura-id",
      WEARABLES_OURA_CLIENT_SECRET: "oura-secret",
      WEARABLES_WHOOP_CLIENT_ID: "whoop-id",
      WEARABLES_POLAR_CLIENT_ID: "polar-id",
      WEARABLES_POLAR_CLIENT_SECRET: "polar-secret",
      WEARABLES_POLAR_WEBHOOK_SECRET: "polar-hook",
      WEARABLES_WEBHOOKS: "true",
    });
    expect(Object.keys(config.providers).sort()).toEqual(["oura", "polar"]);
    expect(config.providers.polar?.webhookSecret).toBe("polar-hook");
    expect(config.providers.oura?.webhookSecret).toBeNull();
    expect(config.webhooks).toBe(true);
    expect(config.missingKeys).toEqual(["WEARABLES_WHOOP_CLIENT_SECRET"]);
    const statuses = describeWearablesIntegrations(config);
    expect(statuses.wearablesOura).toEqual({ provider: "oura", state: "configured" });
    expect(statuses.wearablesWhoop).toEqual({ provider: null, state: "off" });
    expect(JSON.stringify(statuses)).not.toMatch(/secret|oura-id/);
    expect(Object.keys(createWearableAdapters(config, { fetch })).sort()).toEqual([
      "oura",
      "polar",
    ]);
  });

  test("Google Health stays off behind its preview flag even with credentials", () => {
    const credentials = {
      WEARABLES_GOOGLE_HEALTH_CLIENT_ID: "g-id",
      WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET: "g-secret",
    };
    expect(parseWearablesConfig(credentials).providers.google_health).toBeUndefined();
    expect(
      parseWearablesConfig({ ...credentials, WEARABLES_GOOGLE_HEALTH_ENABLED: true }).providers
        .google_health,
    ).toEqual({ clientId: "g-id", clientSecret: "g-secret", webhookSecret: null });
    expect(parseWearablesConfig({ WEARABLES_GOOGLE_HEALTH_ENABLED: "true" }).missingKeys).toEqual([
      "WEARABLES_GOOGLE_HEALTH_CLIENT_ID",
      "WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET",
    ]);
  });
});
