import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import type { CanonicalWriteIntent } from "@openvalens/ingestion";

import { WearableProviderError, WearableWebhookRejected, type WearableAdapter } from "../adapter";
import {
  mockAdapters,
  POLAR_WEBHOOK_SECRET,
  seedVendorData,
  startMockVendor,
  TEST_CLIENT,
  type MockVendor,
} from "../testing";

/**
 * Adapter contract tests (Issue #60): every cloud adapter against a local mock
 * of its vendor API with synthetic payloads shaped like the documented
 * responses. No live vendor is ever called.
 */

let vendor: MockVendor;
let adapters: ReturnType<typeof mockAdapters>;
const WINDOW = {
  from: new Date("2026-09-25T00:00:00.000Z"),
  to: new Date("2026-10-04T00:00:00.000Z"),
};
const REDIRECT = "https://health.example.invalid/api/integrations/wearables/x/callback";

beforeAll(async () => {
  vendor = await startMockVendor();
  adapters = mockAdapters(vendor);
});
afterAll(() => vendor.stop());
beforeEach(() => {
  vendor.state.data = {
    oura: { daily_readiness: [], sleep: [], daily_activity: [] },
    whoop: { recovery: [], sleep: [] },
    polar: { recharges: [], nights: [] },
    withings: { measuregrps: [], series: [] },
    google_health: {},
  };
  seedVendorData(vendor.state);
  vendor.state.refuseRefresh = {};
});

async function connect(adapter: WearableAdapter, userId: string) {
  const tokens = await adapter.exchangeCode({
    code: vendor.issueCode(adapter.id, userId),
    redirectUri: REDIRECT,
  });
  const externalUserId = await adapter.identify(tokens);
  await adapter.onConnected?.({
    accessToken: tokens.accessToken,
    externalUserId,
    webhookUrl: null,
  });
  return { tokens, externalUserId };
}

const summary = (intents: CanonicalWriteIntent[]) =>
  intents.map((intent) =>
    intent.kind === "metric_sample"
      ? [intent.canonicalType, intent.externalId, intent.sampledAt, intent.value, intent.unit]
      : [intent.canonicalType, intent.sourceEventId, intent.eventAt, intent.endAt],
  );

describe("authorization URLs", () => {
  test.each(["oura", "whoop", "polar", "withings", "google_health"] as const)(
    "%s carries client id, redirect, scopes and state",
    (provider) => {
      const url = new URL(
        adapters[provider].authorizationUrl({ state: "s".repeat(43), redirectUri: REDIRECT }),
      );
      expect(url.searchParams.get("client_id")).toBe(TEST_CLIENT.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
      expect(url.searchParams.get("state")).toBe("s".repeat(43));
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe(adapters[provider].scopes);
      expect(url.toString()).not.toContain(TEST_CLIENT.clientSecret);
    },
  );

  test("Google asks for offline access with Standard read-only scopes only", () => {
    const url = new URL(
      adapters.google_health.authorizationUrl({ state: "x", redirectUri: REDIRECT }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes.every((scope) => scope.endsWith(".readonly"))).toBe(true);
    expect(scopes.some((scope) => /ecg|irn/.test(scope))).toBe(false);
  });
});

describe("Oura", () => {
  test("maps readiness, main sleep (HRV, lowest HR) and steps; skips naps; follows pages", async () => {
    const { tokens, externalUserId } = await connect(adapters.oura, "oura-user-1");
    expect(externalUserId).toBe("oura-user-1");
    const intents = await adapters.oura.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: WINDOW,
    });
    expect(summary(intents)).toEqual([
      ["provider_score", "oura-readiness-rd-1-score", "2026-10-01T00:00:00.000Z", 82, "score"],
      ["provider_score", "oura-readiness-rd-2-score", "2026-10-02T00:00:00.000Z", 77, "score"],
      ["sleep_session", "oura-sleep-sl-1", "2026-10-01T22:10:00.000Z", "2026-10-02T06:05:00.000Z"],
      ["hrv_rmssd", "oura-sleep-sl-1-hrv", "2026-10-02T06:05:00.000Z", 48, "ms"],
      ["resting_heart_rate", "oura-sleep-sl-1-rhr", "2026-10-02T06:05:00.000Z", 52, "bpm"],
      ["steps", "oura-activity-ac-1-steps", "2026-10-02T00:00:00.000Z", 8400, "count"],
    ]);
    const score = intents[0]!;
    expect(score.kind === "metric_sample" && score.detail).toEqual({ scoreKind: "oura_readiness" });
  });

  test("refresh rotates the single-use refresh token; reusing it is a reauthorization", async () => {
    const { tokens } = await connect(adapters.oura, "oura-user-2");
    const next = await adapters.oura.refresh(tokens.refreshToken!);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    const error = await adapters.oura.refresh(tokens.refreshToken!).catch((caught) => caught);
    expect(error).toBeInstanceOf(WearableProviderError);
    expect(error).toMatchObject({ category: "reauthorization_required", retryable: false });
    expect(String(error.message)).not.toContain(tokens.refreshToken!);
  });

  test("an expired access token is an auth error; revoke is recorded", async () => {
    const { tokens, externalUserId } = await connect(adapters.oura, "oura-user-3");
    const error = await adapters.oura
      .fetchRecords({ accessToken: "oura-at-stale", externalUserId, window: WINDOW })
      .catch((caught) => caught);
    expect(error).toMatchObject({ category: "auth", status: 401 });
    await adapters.oura.revoke({ ...tokens, externalUserId });
    expect(vendor.state.revoked).toContainEqual({ provider: "oura", userId: "oura-user-3" });
  });

  test("webhooks: signed create is a sync hint, delete names the record, bad signature rejected", () => {
    const sign = (timestamp: string, body: string) =>
      createHmac("sha256", TEST_CLIENT.clientSecret)
        .update(timestamp + body)
        .digest("hex")
        .toUpperCase();
    const deliver = (body: object, signature?: string) => {
      const rawBody = JSON.stringify(body);
      const headers = new Headers({
        "x-oura-timestamp": "1790000000",
        "x-oura-signature": signature ?? sign("1790000000", rawBody),
      });
      return adapters.oura.parseWebhook!({ headers, rawBody, now: new Date() });
    };
    expect(
      deliver({ event_type: "create", data_type: "sleep", object_id: "sl-9", user_id: "u9" }),
    ).toEqual([{ kind: "data_changed", externalUserId: "u9" }]);
    expect(
      deliver({ event_type: "delete", data_type: "sleep", object_id: "sl-9", user_id: "u9" }),
    ).toEqual([
      { kind: "record_deleted", externalUserId: "u9", externalRecordId: "oura-sleep-sl-9" },
    ]);
    expect(() =>
      deliver({ event_type: "create", data_type: "sleep", object_id: "x", user_id: "u9" }, "00"),
    ).toThrow(WearableWebhookRejected);
  });
});

describe("Whoop", () => {
  test("maps scored recoveries (score, RHR, HRV) and sleep; skips unscored", async () => {
    const { tokens, externalUserId } = await connect(adapters.whoop, "4242");
    expect(externalUserId).toBe("4242");
    const intents = await adapters.whoop.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: WINDOW,
    });
    expect(summary(intents)).toEqual([
      ["provider_score", "whoop-recovery-wsl-1-score", "2026-10-02T07:30:00.000Z", 66, "score"],
      ["resting_heart_rate", "whoop-recovery-wsl-1-rhr", "2026-10-02T07:30:00.000Z", 54, "bpm"],
      ["hrv_rmssd", "whoop-recovery-wsl-1-hrv", "2026-10-02T07:30:00.000Z", 61.5, "ms"],
      [
        "sleep_session",
        "whoop-sleep-wsl-1",
        "2026-10-01T22:40:00.000Z",
        "2026-10-02T06:50:00.000Z",
      ],
    ]);
  });

  test("webhooks need a fresh, valid base64 HMAC", () => {
    const now = new Date("2026-10-02T08:00:00.000Z");
    const deliver = (body: object, at = now.getTime(), tamper = false) => {
      const rawBody = JSON.stringify(body);
      const timestamp = String(at);
      const signature = createHmac("sha256", TEST_CLIENT.clientSecret)
        .update(timestamp + rawBody)
        .digest("base64");
      const headers = new Headers({
        "x-whoop-signature": tamper ? `x${signature.slice(1)}` : signature,
        "x-whoop-signature-timestamp": timestamp,
      });
      return adapters.whoop.parseWebhook!({ headers, rawBody, now });
    };
    expect(deliver({ user_id: 4242, id: "wsl-1", type: "sleep.updated" })).toEqual([
      { kind: "data_changed", externalUserId: "4242" },
    ]);
    expect(deliver({ user_id: 4242, id: "wsl-1", type: "recovery.deleted" })).toEqual([
      { kind: "record_deleted", externalUserId: "4242", externalRecordId: "whoop-recovery-wsl-1" },
    ]);
    expect(deliver({ user_id: 4242, id: 1, type: "workout.updated" })).toEqual([]);
    expect(() =>
      deliver({ user_id: 4242, type: "sleep.updated" }, now.getTime() - 600_000),
    ).toThrow(WearableWebhookRejected);
    expect(() => deliver({ user_id: 4242, type: "sleep.updated" }, now.getTime(), true)).toThrow(
      WearableWebhookRejected,
    );
  });
});

describe("Polar", () => {
  test("Basic-auth exchange returns the Polar user, registers it, maps recharge and sleep", async () => {
    const { tokens, externalUserId } = await connect(adapters.polar, "7001");
    expect(tokens).toMatchObject({ refreshToken: null, expiresAt: null, externalUserId: "7001" });
    expect(vendor.state.polarRegistered.has("7001")).toBe(true);
    // Registering again (reconnect) is fine: 409 is ignored.
    await adapters.polar.onConnected!({
      accessToken: tokens.accessToken,
      externalUserId,
      webhookUrl: null,
    });
    const intents = await adapters.polar.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: WINDOW,
    });
    expect(summary(intents)).toEqual([
      [
        "provider_score",
        "polar-recharge-2026-10-02-status",
        "2026-10-02T00:00:00.000Z",
        4,
        "score",
      ],
      ["hrv_rmssd", "polar-recharge-2026-10-02-hrv", "2026-10-02T00:00:00.000Z", 44, "ms"],
      [
        "sleep_session",
        "polar-sleep-2026-10-02",
        "2026-10-01T21:00:00.000Z",
        "2026-10-02T04:45:00.000Z",
      ],
    ]);
    // Out-of-window records are dropped.
    const later = await adapters.polar.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-02T00:00:00Z") },
    });
    expect(later).toEqual([]);
  });

  test("there is no refresh grant; revoke de-registers and kills the token", async () => {
    const { tokens, externalUserId } = await connect(adapters.polar, "7002");
    await expect(adapters.polar.refresh("x")).rejects.toMatchObject({
      category: "reauthorization_required",
    });
    await adapters.polar.revoke({ ...tokens, externalUserId });
    expect(vendor.state.polarRegistered.has("7002")).toBe(false);
    await expect(
      adapters.polar.fetchRecords({
        accessToken: tokens.accessToken,
        externalUserId,
        window: WINDOW,
      }),
    ).rejects.toMatchObject({ category: "auth" });
  });

  test("webhooks verify the hex HMAC with the webhook secret", () => {
    const rawBody = JSON.stringify({ event: "SLEEP", user_id: 7001, entity_id: "e1" });
    const good = createHmac("sha256", POLAR_WEBHOOK_SECRET).update(rawBody).digest("hex");
    const parse = (signature: string) =>
      adapters.polar.parseWebhook!({
        headers: new Headers({ "polar-webhook-signature": signature }),
        rawBody,
        now: new Date(),
      });
    expect(parse(good)).toEqual([{ kind: "data_changed", externalUserId: "7001" }]);
    expect(() => parse("0".repeat(64))).toThrow(WearableWebhookRejected);
  });
});

describe("Withings", () => {
  test("unwraps status/body, scales measures and maps sleep summaries", async () => {
    const { tokens, externalUserId } = await connect(adapters.withings, "31337");
    expect(externalUserId).toBe("31337");
    const intents = await adapters.withings.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: WINDOW,
    });
    expect(summary(intents)).toEqual([
      ["weight", "withings-measure-9001-weight", "2026-10-02T06:00:00.000Z", 72.45, "kg"],
      ["body_fat", "withings-measure-9001-fat", "2026-10-02T06:00:00.000Z", 21.5, "%"],
      [
        "sleep_session",
        "withings-sleep-5501",
        "2026-10-01T22:30:00.000Z",
        "2026-10-02T06:15:00.000Z",
      ],
    ]);
  });

  test("subscribes notifications only with a webhook URL; a bad refresh is a reauthorization", async () => {
    const { tokens, externalUserId } = await connect(adapters.withings, "31338");
    expect(vendor.state.withingsSubscriptions).toEqual([]);
    await adapters.withings.onConnected!({
      accessToken: tokens.accessToken,
      externalUserId,
      webhookUrl: "https://health.example.invalid/api/integrations/wearables/withings/webhook",
    });
    expect(vendor.state.withingsSubscriptions.map((sub) => sub.appli)).toEqual(["1", "44"]);
    await expect(adapters.withings.refresh("not-a-token")).rejects.toMatchObject({
      category: "reauthorization_required",
    });
  });

  test("revoke signs a nonce request and the revoke call", async () => {
    const { tokens, externalUserId } = await connect(adapters.withings, "31339");
    await adapters.withings.revoke({ ...tokens, externalUserId });
    expect(vendor.state.revoked).toContainEqual({ provider: "withings", userId: "31339" });
    await expect(adapters.withings.identify(tokens)).rejects.toMatchObject({ category: "auth" });
  });

  test("notifications are unsigned hints; unlink becomes a deauthorization candidate", () => {
    const parse = (rawBody: string) =>
      adapters.withings.parseWebhook!({ headers: new Headers(), rawBody, now: new Date() });
    expect(parse("userid=31337&appli=1&startdate=1&enddate=2")).toEqual([
      { kind: "data_changed", externalUserId: "31337" },
    ]);
    expect(parse("userid=31337&appli=46")).toEqual([
      { kind: "deauthorized", externalUserId: "31337" },
    ]);
    expect(parse("userid=abc&appli=1")).toEqual([]);
  });
});

describe("Google Health", () => {
  test("identity from users/me/identity; steps summed per UTC day; weight, RHR, HRV, sleep", async () => {
    const { tokens, externalUserId } = await connect(adapters.google_health, "g-health-1");
    expect(externalUserId).toBe("g-health-1");
    const intents = await adapters.google_health.fetchRecords({
      accessToken: tokens.accessToken,
      externalUserId,
      window: WINDOW,
    });
    expect(summary(intents)).toEqual([
      ["steps", "google_health-steps-2026-10-02-steps", "2026-10-02T00:00:00.000Z", 200, "count"],
      ["steps", "google_health-steps-2026-10-03-steps", "2026-10-03T00:00:00.000Z", 50, "count"],
      ["weight", "google_health-weight-w1-weight", "2026-10-02T06:30:00.000Z", 71.8, "kg"],
      [
        "resting_heart_rate",
        "google_health-rhr-2026-10-02-rhr",
        "2026-10-02T00:00:00.000Z",
        57,
        "bpm",
      ],
      ["hrv_rmssd", "google_health-hrv-2026-10-02-hrv", "2026-10-02T00:00:00.000Z", 39.5, "ms"],
      [
        "sleep_session",
        "google_health-sleep-z1",
        "2026-10-01T22:55:00.000Z",
        "2026-10-02T06:40:00.000Z",
      ],
    ]);
    const stepsCall = vendor.state.calls.find((call) => call.path.endsWith("/steps/dataPoints"));
    expect(stepsCall).toBeDefined();
  });

  test("a Testing-mode refresh refusal (invalid_grant) is a reauthorization; refresh keeps the token", async () => {
    const { tokens } = await connect(adapters.google_health, "g-health-2");
    const refreshed = await adapters.google_health.refresh(tokens.refreshToken!);
    expect(refreshed.refreshToken).toBeTruthy();
    vendor.state.refuseRefresh.google_health = true;
    await expect(adapters.google_health.refresh(refreshed.refreshToken!)).rejects.toMatchObject({
      category: "reauthorization_required",
      providerError: "invalid_grant",
    });
  });

  test("has no webhooks (polling only) and revokes the refresh token", async () => {
    expect(adapters.google_health.parseWebhook).toBeUndefined();
    const { tokens, externalUserId } = await connect(adapters.google_health, "g-health-3");
    await adapters.google_health.revoke({ ...tokens, externalUserId });
    expect(vendor.state.revoked).toContainEqual({
      provider: "google_health",
      userId: "g-health-3",
    });
  });
});

describe("transport errors", () => {
  test("network failures and 5xx are retryable, values never in the message", async () => {
    const failing = mockAdapters(vendor, {
      fetch: (async () => {
        throw new TypeError("connect ECONNREFUSED secret-host");
      }) as unknown as typeof fetch,
    });
    const error = await failing.oura
      .identify({
        accessToken: "oura-at-x",
        refreshToken: null,
        expiresAt: null,
        scope: null,
        externalUserId: null,
      })
      .catch((caught) => caught);
    expect(error).toMatchObject({ category: "network", retryable: true });
    expect(String(error.message)).not.toContain("secret-host");
  });
});
