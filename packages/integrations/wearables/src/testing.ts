import { createHmac } from "node:crypto";

import type { WearableAdapter, WearableProviderId } from "./adapter";
import { createGoogleHealthAdapter } from "./providers/google-health";
import { createOuraAdapter } from "./providers/oura";
import { createPolarAdapter } from "./providers/polar";
import { createWhoopAdapter } from "./providers/whoop";
import { createWithingsAdapter } from "./providers/withings";

/**
 * Local mock of the five vendor APIs for tests (Issue #60). One `Bun.serve`
 * on an ephemeral loopback port answers under `/<provider>/…` with payloads
 * shaped like each vendor's documented responses. Synthetic data only; no
 * test ever reaches a real vendor.
 *
 * Behaviour that matters to the service is modelled: authorization codes,
 * access-token checks (401 / Withings status 401), **single-use refresh
 * tokens** (a reused one answers `invalid_grant`), revocation, Polar user
 * registration, Withings request signatures, and two-item pagination.
 */

export const TEST_CLIENT = { clientId: "synthetic-client", clientSecret: "synthetic-secret-0123" };
export const POLAR_WEBHOOK_SECRET = "synthetic-polar-webhook-secret";

export type MockVendor = {
  url: string;
  state: MockVendorState;
  /** Mints a one-time authorization code for a vendor user. */
  issueCode(provider: WearableProviderId, userId: string): string;
  stop(): Promise<void>;
};

type Grant = { provider: WearableProviderId; userId: string };

export type MockVendorState = {
  calls: { provider: string; method: string; path: string }[];
  codes: Map<string, Grant>;
  accessTokens: Map<string, Grant & { expiresAt: number }>;
  refreshTokens: Map<string, Grant>;
  refreshCalls: Record<string, number>;
  revoked: { provider: WearableProviderId; userId: string }[];
  polarRegistered: Set<string>;
  withingsSubscriptions: { callbackurl: string; appli: string }[];
  /** Access token lifetime in seconds, per provider (default 3600). */
  expiresIn: Partial<Record<WearableProviderId, number>>;
  /** Milliseconds a refresh takes, to widen race windows in tests. */
  refreshDelayMs: number;
  /** Every refresh answers `invalid_grant` (e.g. a Google Testing-mode token past 7 days). */
  refuseRefresh: Partial<Record<WearableProviderId, boolean>>;
  /** Vendor payload items, per provider and collection. */
  data: {
    oura: Record<"daily_readiness" | "sleep" | "daily_activity", Record<string, unknown>[]>;
    whoop: Record<"recovery" | "sleep", Record<string, unknown>[]>;
    polar: Record<"recharges" | "nights", Record<string, unknown>[]>;
    withings: Record<"measuregrps" | "series", Record<string, unknown>[]>;
    google_health: Record<string, Record<string, unknown>[]>;
  };
};

function emptyData(): MockVendorState["data"] {
  return {
    oura: { daily_readiness: [], sleep: [], daily_activity: [] },
    whoop: { recovery: [], sleep: [] },
    polar: { recharges: [], nights: [] },
    withings: { measuregrps: [], series: [] },
    google_health: {},
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two items per page, with `<cursor>` = next index. */
function page<T>(items: T[], cursor: string | null): { items: T[]; next: string | null } {
  const start = cursor ? Number(cursor) : 0;
  const next = start + 2 < items.length ? String(start + 2) : null;
  return { items: items.slice(start, start + 2), next };
}

export async function startMockVendor(): Promise<MockVendor> {
  const state: MockVendorState = {
    calls: [],
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    refreshCalls: {},
    revoked: [],
    polarRegistered: new Set(),
    withingsSubscriptions: [],
    expiresIn: {},
    refreshDelayMs: 0,
    refuseRefresh: {},
    data: emptyData(),
  };
  let counter = 0;

  function mint(grant: Grant) {
    counter += 1;
    const lifetime = state.expiresIn[grant.provider] ?? 3600;
    const accessToken = `${grant.provider}-at-${counter}`;
    const refreshToken = `${grant.provider}-rt-${counter}`;
    state.accessTokens.set(accessToken, { ...grant, expiresAt: Date.now() + lifetime * 1000 });
    state.refreshTokens.set(refreshToken, grant);
    return { accessToken, refreshToken, lifetime };
  }

  function bearerGrant(request: Request, provider: WearableProviderId): Grant | null {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const grant = state.accessTokens.get(token);
    return grant && grant.provider === provider && grant.expiresAt > Date.now() ? grant : null;
  }

  /** OAuth token endpoint shared by Oura, Whoop and Google. */
  async function oauthToken(provider: WearableProviderId, form: URLSearchParams) {
    if (form.get("client_secret") !== TEST_CLIENT.clientSecret)
      return json({ error: "invalid_client" }, 401);
    let grant: Grant | undefined;
    if (form.get("grant_type") === "authorization_code") {
      grant = state.codes.get(form.get("code") ?? "");
      state.codes.delete(form.get("code") ?? "");
    } else {
      state.refreshCalls[provider] = (state.refreshCalls[provider] ?? 0) + 1;
      await sleep(state.refreshDelayMs);
      const refreshToken = form.get("refresh_token") ?? "";
      grant = state.refuseRefresh[provider] ? undefined : state.refreshTokens.get(refreshToken);
      // Single use: a refresh token can never be spent twice.
      state.refreshTokens.delete(refreshToken);
    }
    if (!grant || grant.provider !== provider) return json({ error: "invalid_grant" }, 400);
    const minted = mint(grant);
    return json({
      access_token: minted.accessToken,
      refresh_token: minted.refreshToken,
      expires_in: minted.lifetime,
      token_type: "bearer",
      scope: "synthetic",
    });
  }

  const withings = (body: unknown, status = 0) => json({ status, body });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const [, provider, ...rest] = url.pathname.split("/");
      const path = `/${rest.join("/")}`;
      state.calls.push({ provider: provider ?? "", method: request.method, path });
      const form =
        request.method === "POST" &&
        request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
          ? new URLSearchParams(await request.text())
          : new URLSearchParams();

      if (provider === "oura") {
        if (path === "/oauth/token") return oauthToken("oura", form);
        if (path === "/oauth/revoke") {
          const grant = state.accessTokens.get(url.searchParams.get("access_token") ?? "");
          if (!grant) return json({ error: "invalid_token" }, 400);
          state.revoked.push({ provider: "oura", userId: grant.userId });
          return new Response(null, { status: 200 });
        }
        const grant = bearerGrant(request, "oura");
        if (!grant) return json({ detail: "unauthorized" }, 401);
        if (path === "/v2/usercollection/personal_info") return json({ id: grant.userId });
        const collection = path.replace(
          "/v2/usercollection/",
          "",
        ) as keyof MockVendorState["data"]["oura"];
        const items = state.data.oura[collection];
        if (!items) return json({ detail: "not found" }, 404);
        const result = page(items, url.searchParams.get("next_token"));
        return json({ data: result.items, next_token: result.next });
      }

      if (provider === "whoop") {
        if (path === "/oauth/oauth2/token") return oauthToken("whoop", form);
        const grant = bearerGrant(request, "whoop");
        if (!grant) return json({}, 401);
        if (path === "/developer/v2/user/profile/basic")
          return json({ user_id: Number(grant.userId) });
        if (path === "/developer/v2/user/access" && request.method === "DELETE") {
          state.revoked.push({ provider: "whoop", userId: grant.userId });
          return new Response(null, { status: 204 });
        }
        const items =
          path === "/developer/v2/recovery"
            ? state.data.whoop.recovery
            : path === "/developer/v2/activity/sleep"
              ? state.data.whoop.sleep
              : null;
        if (!items) return json({}, 404);
        const result = page(items, url.searchParams.get("nextToken"));
        return json({ records: result.items, next_token: result.next });
      }

      if (provider === "polar") {
        if (path === "/token") {
          const expected = `Basic ${Buffer.from(`${TEST_CLIENT.clientId}:${TEST_CLIENT.clientSecret}`).toString("base64")}`;
          if (request.headers.get("authorization") !== expected)
            return json({ error: "invalid_client" }, 401);
          const grant = state.codes.get(form.get("code") ?? "");
          state.codes.delete(form.get("code") ?? "");
          if (!grant) return json({ error: "invalid_grant" }, 400);
          const minted = mint(grant);
          return json({
            access_token: minted.accessToken,
            token_type: "bearer",
            expires_in: 315_360_000,
            x_user_id: Number(grant.userId),
          });
        }
        const grant = bearerGrant(request, "polar");
        if (!grant) return json({}, 401);
        if (path === "/v3/users" && request.method === "POST") {
          if (state.polarRegistered.has(grant.userId)) return json({}, 409);
          state.polarRegistered.add(grant.userId);
          return json({ "polar-user-id": Number(grant.userId) });
        }
        if (path === `/v3/users/${grant.userId}`) {
          if (request.method === "DELETE") {
            state.polarRegistered.delete(grant.userId);
            state.revoked.push({ provider: "polar", userId: grant.userId });
            for (const [token, value] of state.accessTokens)
              if (value.provider === "polar" && value.userId === grant.userId)
                state.accessTokens.delete(token);
            return new Response(null, { status: 204 });
          }
          return state.polarRegistered.has(grant.userId)
            ? json({ "polar-user-id": Number(grant.userId) })
            : json({}, 404);
        }
        if (path === "/v3/users/nightly-recharge")
          return json({ recharges: state.data.polar.recharges });
        if (path === "/v3/users/sleep") return json({ nights: state.data.polar.nights });
        return json({}, 404);
      }

      if (provider === "withings") {
        const action = form.get("action");
        const sign = (...values: string[]) =>
          createHmac("sha256", TEST_CLIENT.clientSecret).update(values.join(",")).digest("hex");
        if (path === "/v2/oauth2" && action === "requesttoken") {
          if (form.get("client_secret") !== TEST_CLIENT.clientSecret) return withings({}, 503);
          let grant: Grant | undefined;
          if (form.get("grant_type") === "authorization_code") {
            grant = state.codes.get(form.get("code") ?? "");
            state.codes.delete(form.get("code") ?? "");
          } else {
            state.refreshCalls.withings = (state.refreshCalls.withings ?? 0) + 1;
            grant = state.refuseRefresh.withings
              ? undefined
              : state.refreshTokens.get(form.get("refresh_token") ?? "");
            state.refreshTokens.delete(form.get("refresh_token") ?? "");
          }
          if (!grant) return withings({}, 503);
          const minted = mint(grant);
          return withings({
            userid: grant.userId,
            access_token: minted.accessToken,
            refresh_token: minted.refreshToken,
            expires_in: minted.lifetime,
            scope: "user.metrics,user.activity",
            token_type: "Bearer",
          });
        }
        if (path === "/v2/signature" && action === "getnonce") {
          const timestamp = form.get("timestamp") ?? "";
          if (form.get("signature") !== sign("getnonce", TEST_CLIENT.clientId, timestamp))
            return withings({}, 2554);
          return withings({ nonce: `nonce-${timestamp}` });
        }
        if (path === "/v2/oauth2" && action === "revoke") {
          const nonce = form.get("nonce") ?? "";
          if (form.get("signature") !== sign("revoke", TEST_CLIENT.clientId, nonce))
            return withings({}, 2554);
          const userId = form.get("userid") ?? "";
          state.revoked.push({ provider: "withings", userId });
          for (const [token, value] of state.accessTokens)
            if (value.provider === "withings" && value.userId === userId)
              state.accessTokens.delete(token);
          return withings({});
        }
        const grant = bearerGrant(request, "withings");
        if (!grant) return withings({}, 401);
        if (path === "/v2/user" && action === "getdevice") return withings({ devices: [] });
        if (path === "/notify" && action === "subscribe") {
          state.withingsSubscriptions.push({
            callbackurl: form.get("callbackurl") ?? "",
            appli: form.get("appli") ?? "",
          });
          return withings({});
        }
        const key =
          path === "/measure" && action === "getmeas"
            ? "measuregrps"
            : path === "/v2/sleep" && action === "getsummary"
              ? "series"
              : null;
        if (!key) return withings({}, 2555);
        const result = page(state.data.withings[key], form.get("offset"));
        return withings({
          [key]: result.items,
          more: result.next !== null,
          offset: result.next ?? 0,
        });
      }

      if (provider === "google") {
        if (path === "/token") return oauthToken("google_health", form);
        if (path === "/revoke") {
          const token = form.get("token") ?? "";
          const grant = state.refreshTokens.get(token) ?? state.accessTokens.get(token);
          if (!grant) return json({ error: "invalid_token" }, 400);
          state.revoked.push({ provider: "google_health", userId: grant.userId });
          return json({});
        }
        const grant = bearerGrant(request, "google_health");
        if (!grant) return json({ error: { code: 401 } }, 401);
        if (path === "/v4/users/me/identity")
          return json({ name: "users/me/identity", healthUserId: grant.userId });
        const match = /^\/v4\/users\/me\/dataTypes\/([a-z-]+)\/dataPoints$/.exec(path);
        if (!match) return json({}, 404);
        const result = page(
          state.data.google_health[match[1]!] ?? [],
          url.searchParams.get("pageToken"),
        );
        return json({ dataPoints: result.items, nextPageToken: result.next ?? "" });
      }
      return json({}, 404);
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    state,
    issueCode(provider, userId) {
      counter += 1;
      const code = `code-${provider}-${counter}`;
      state.codes.set(code, { provider, userId });
      return code;
    },
    stop: () => server.stop(true),
  };
}

/** Every adapter, pointed at the mock vendor. */
export function mockAdapters(
  vendor: Pick<MockVendor, "url">,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Record<WearableProviderId, WearableAdapter> {
  const base = vendor.url;
  const http = { fetch: deps.fetch ?? globalThis.fetch, timeoutMs: 5_000 };
  return {
    oura: createOuraAdapter(TEST_CLIENT, {
      ...http,
      endpoints: {
        authorize: `${base}/oura/oauth/authorize`,
        token: `${base}/oura/oauth/token`,
        revoke: `${base}/oura/oauth/revoke`,
        api: `${base}/oura`,
      },
    }),
    whoop: createWhoopAdapter(TEST_CLIENT, {
      ...http,
      endpoints: {
        authorize: `${base}/whoop/oauth/oauth2/auth`,
        token: `${base}/whoop/oauth/oauth2/token`,
        api: `${base}/whoop/developer`,
      },
    }),
    polar: createPolarAdapter(
      { ...TEST_CLIENT, webhookSecret: POLAR_WEBHOOK_SECRET },
      {
        ...http,
        endpoints: {
          authorize: `${base}/polar/oauth2/authorization`,
          token: `${base}/polar/token`,
          api: `${base}/polar`,
        },
      },
    ),
    withings: createWithingsAdapter(TEST_CLIENT, {
      ...http,
      ...(deps.now ? { now: deps.now } : {}),
      endpoints: { authorize: `${base}/withings/authorize2`, api: `${base}/withings` },
    }),
    google_health: createGoogleHealthAdapter(TEST_CLIENT, {
      ...http,
      endpoints: {
        authorize: `${base}/google/auth`,
        token: `${base}/google/token`,
        revoke: `${base}/google/revoke`,
        api: `${base}/google/v4`,
      },
    }),
  };
}

/** Synthetic payloads shaped like each vendor's documented responses. */
export function seedVendorData(state: MockVendorState) {
  state.data.oura = {
    daily_readiness: [
      { id: "rd-1", day: "2026-10-01", score: 82, timestamp: "2026-10-01T00:00:00+00:00" },
      { id: "rd-2", day: "2026-10-02", score: 77, timestamp: "2026-10-02T00:00:00+00:00" },
    ],
    sleep: [
      {
        id: "sl-1",
        day: "2026-10-02",
        type: "long_sleep",
        bedtime_start: "2026-10-01T23:10:00+01:00",
        bedtime_end: "2026-10-02T07:05:00+01:00",
        average_hrv: 48,
        lowest_heart_rate: 52,
      },
      {
        id: "nap-1",
        day: "2026-10-02",
        type: "late_nap",
        bedtime_start: "2026-10-02T14:00:00+01:00",
        bedtime_end: "2026-10-02T14:30:00+01:00",
        average_hrv: 40,
        lowest_heart_rate: 60,
      },
    ],
    daily_activity: [{ id: "ac-1", day: "2026-10-02", steps: 8400 }],
  };
  state.data.whoop = {
    recovery: [
      {
        cycle_id: 101,
        sleep_id: "wsl-1",
        user_id: 4242,
        created_at: "2026-10-02T07:30:00.000Z",
        updated_at: "2026-10-02T07:31:00.000Z",
        score_state: "SCORED",
        score: { recovery_score: 66, resting_heart_rate: 54, hrv_rmssd_milli: 61.5 },
      },
      {
        cycle_id: 102,
        sleep_id: "wsl-2",
        user_id: 4242,
        created_at: "2026-10-03T07:30:00.000Z",
        updated_at: "2026-10-03T07:30:00.000Z",
        score_state: "PENDING_SCORE",
      },
    ],
    sleep: [
      {
        id: "wsl-1",
        user_id: 4242,
        start: "2026-10-01T22:40:00.000Z",
        end: "2026-10-02T06:50:00.000Z",
        updated_at: "2026-10-02T07:00:00.000Z",
        nap: false,
        score_state: "SCORED",
      },
    ],
  };
  state.data.polar = {
    recharges: [
      {
        polar_user: "https://www.polaraccesslink.com/v3/users/7001",
        date: "2026-10-02",
        heart_rate_variability_avg: 44,
        nightly_recharge_status: 4,
        ans_charge: -2.5,
      },
    ],
    nights: [
      {
        polar_user: "https://www.polaraccesslink.com/v3/users/7001",
        date: "2026-10-02",
        sleep_start_time: "2026-10-01T23:00:00.000+02:00",
        sleep_end_time: "2026-10-02T06:45:00.000+02:00",
      },
    ],
  };
  state.data.withings = {
    measuregrps: [
      {
        grpid: 9001,
        date: Date.parse("2026-10-02T06:00:00Z") / 1000,
        modified: Date.parse("2026-10-02T06:00:05Z") / 1000,
        category: 1,
        measures: [
          { value: 72450, type: 1, unit: -3 },
          { value: 215, type: 6, unit: -1 },
        ],
      },
    ],
    series: [
      {
        id: 5501,
        startdate: Date.parse("2026-10-01T22:30:00Z") / 1000,
        enddate: Date.parse("2026-10-02T06:15:00Z") / 1000,
        date: "2026-10-02",
        modified: Date.parse("2026-10-02T06:20:00Z") / 1000,
      },
    ],
  };
  state.data.google_health = {
    steps: [
      {
        name: "users/me/dataTypes/steps/dataPoints/s1",
        steps: {
          interval: { startTime: "2026-10-02T08:00:00Z", endTime: "2026-10-02T08:01:00Z" },
          count: "120",
        },
      },
      {
        name: "users/me/dataTypes/steps/dataPoints/s2",
        steps: {
          interval: { startTime: "2026-10-02T09:00:00Z", endTime: "2026-10-02T09:01:00Z" },
          count: "80",
        },
      },
      {
        name: "users/me/dataTypes/steps/dataPoints/s3",
        steps: {
          interval: { startTime: "2026-10-03T09:00:00Z", endTime: "2026-10-03T09:01:00Z" },
          count: "50",
        },
      },
    ],
    weight: [
      {
        name: "users/me/dataTypes/weight/dataPoints/w1",
        weight: { sampleTime: { physicalTime: "2026-10-02T06:30:00Z" }, weightGrams: 71800 },
      },
    ],
    "daily-resting-heart-rate": [
      {
        name: "users/me/dataTypes/daily-resting-heart-rate/dataPoints/r1",
        dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 2 }, beatsPerMinute: "57" },
      },
    ],
    "daily-heart-rate-variability": [
      {
        name: "users/me/dataTypes/daily-heart-rate-variability/dataPoints/h1",
        dailyHeartRateVariability: {
          date: { year: 2026, month: 10, day: 2 },
          averageHeartRateVariabilityMilliseconds: 39.5,
        },
      },
    ],
    sleep: [
      {
        name: "users/me/dataTypes/sleep/dataPoints/z1",
        sleep: {
          interval: { startTime: "2026-10-01T22:55:00Z", endTime: "2026-10-02T06:40:00Z" },
          type: "STAGES",
          updateTime: "2026-10-02T07:00:00Z",
        },
      },
    ],
  };
}
