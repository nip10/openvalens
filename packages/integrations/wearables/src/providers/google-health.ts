import type { CanonicalWriteIntent } from "@openvalens/ingestion";

import {
  asArray,
  asRecord,
  bearer,
  num,
  parseTokenResponse,
  requestJson,
  str,
  utcIso,
  WearableProviderError,
  type WearableAdapter,
  type WearableEndpoints,
  type WearableHttpDeps,
} from "../adapter";
import { dayInterval, metricIntent, recordId, sleepIntent } from "../intents";

/**
 * Google Health API adapter (Fitbit / Pixel successor, public preview since
 * 2026-10-01), plain `fetch`, pinned to REST **v4**. Docs:
 * https://developers.google.com/health/reference/rest (checked 2026-10-16; no
 * live call has been made).
 *
 * - Google OAuth with `access_type=offline` and `prompt=consent` so a
 *   refresh token is issued. Only the read-only **Standard** scopes are
 *   requested; the Sensitive ones (ECG, irregular rhythm) are not.
 * - **Testing mode**: refresh tokens of an unverified external app expire
 *   after 7 days. The refresh then fails with `invalid_grant`, the service
 *   marks the connection "reconnect needed", and reconnecting backfills from
 *   the last synced instant, so there is no silent gap.
 * - Reads `steps` (summed into UTC-day totals), `weight`,
 *   `daily-resting-heart-rate`, `daily-heart-rate-variability` (average HRV)
 *   and `sleep` through `users/me/dataTypes/{type}/dataPoints` with AIP-160
 *   time filters. Webhooks are not used: Google Health syncs by polling.
 * - Off unless `WEARABLES_GOOGLE_HEALTH_ENABLED=true`, while the API is in
 *   preview.
 */

export type GoogleHealthEndpointKey = "authorize" | "token" | "revoke" | "api";

export const GOOGLE_HEALTH_ENDPOINTS: WearableEndpoints<GoogleHealthEndpointKey> = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://health.googleapis.com/v4",
};

const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";

export const GOOGLE_HEALTH_SCOPES = [
  "activity_and_fitness.readonly",
  "health_metrics_and_measurements.readonly",
  "sleep.readonly",
  "profile.readonly",
]
  .map((scope) => `${SCOPE_PREFIX}${scope}`)
  .join(" ");

type GoogleDate = { year?: unknown; month?: unknown; day?: unknown };

function civilDate(value: unknown): string | null {
  const date = asRecord(value) as GoogleDate | null;
  if (!date || typeof date.year !== "number" || typeof date.month !== "number") return null;
  if (typeof date.day !== "number") return null;
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function createGoogleHealthAdapter(
  credentials: { clientId: string; clientSecret: string },
  deps: WearableHttpDeps & { endpoints?: Partial<WearableEndpoints<GoogleHealthEndpointKey>> },
): WearableAdapter {
  const urls = { ...GOOGLE_HEALTH_ENDPOINTS, ...deps.endpoints };

  const token = async (values: Record<string, string>) =>
    parseTokenResponse(
      "google_health",
      await requestJson(deps, "google_health", urls.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...values,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
        oauth: true,
      }),
    );

  /** Every page of one data type, filtered by an AIP-160 expression. */
  async function dataPoints(
    accessToken: string,
    dataType: string,
    filter: string,
    pageSize: number,
  ) {
    const items: Record<string, unknown>[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query = new URLSearchParams({ filter, pageSize: String(pageSize) });
      if (pageToken) query.set("pageToken", pageToken);
      const body = asRecord(
        await requestJson(
          deps,
          "google_health",
          `${urls.api}/users/me/dataTypes/${dataType}/dataPoints?${query}`,
          { headers: bearer(accessToken) },
        ),
      );
      if (!body) throw new WearableProviderError("google_health", "invalid_response", 200);
      for (const item of asArray(body.dataPoints)) {
        const record = asRecord(item);
        if (record) items.push(record);
      }
      pageToken = str(body, "nextPageToken");
      if (!pageToken) break;
    }
    return items;
  }

  return {
    id: "google_health",
    scopes: GOOGLE_HEALTH_SCOPES,
    refreshes: true,

    authorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: GOOGLE_HEALTH_SCOPES,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return `${urls.authorize}?${query}`;
    },

    exchangeCode: ({ code, redirectUri }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),

    async refresh(refreshToken) {
      const tokens = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
      // Google omits the refresh token on refresh; keep using the one we have.
      return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
    },

    async identify(tokens) {
      const body = asRecord(
        await requestJson(deps, "google_health", `${urls.api}/users/me/identity`, {
          headers: bearer(tokens.accessToken),
        }),
      );
      const id = body ? str(body, "healthUserId") : null;
      if (!id) throw new WearableProviderError("google_health", "invalid_response", 200);
      return id;
    },

    async fetchRecords({ accessToken, window }) {
      const intents: CanonicalWriteIntent[] = [];
      const from = window.from.toISOString();
      const to = window.to.toISOString();
      const fromDay = from.slice(0, 10);

      // Steps arrive as short intervals; store one total per UTC day.
      const stepsPerDay = new Map<string, number>();
      for (const point of await dataPoints(
        accessToken,
        "steps",
        `steps.interval.start_time >= "${from}" AND steps.interval.start_time < "${to}"`,
        10_000,
      )) {
        const steps = asRecord(point.steps);
        const start = steps ? utcIso(asRecord(steps.interval)?.startTime) : null;
        const count = steps ? num(steps, "count") : null;
        if (!start || count === null) continue;
        const day = start.slice(0, 10);
        stepsPerDay.set(day, (stepsPerDay.get(day) ?? 0) + count);
      }
      for (const [day, total] of stepsPerDay) {
        const interval = dayInterval(day);
        if (!interval) continue;
        intents.push(
          metricIntent("google_health", {
            externalId: `${recordId("google_health", "steps", day)}-steps`,
            canonicalType: "steps",
            ...interval,
            value: total,
            unit: "count",
          }),
        );
      }

      for (const point of await dataPoints(
        accessToken,
        "weight",
        `weight.sample_time.physical_time >= "${from}" AND weight.sample_time.physical_time < "${to}"`,
        1_000,
      )) {
        const weight = asRecord(point.weight);
        const at = weight ? utcIso(asRecord(weight.sampleTime)?.physicalTime) : null;
        const grams = weight ? num(weight, "weightGrams") : null;
        const name = str(point, "name");
        if (!at || grams === null || !name) continue;
        intents.push(
          metricIntent("google_health", {
            externalId: `${recordId("google_health", "weight", name.split("/").pop() ?? name)}-weight`,
            canonicalType: "weight",
            sampledAt: at,
            value: grams / 1000,
            unit: "kg",
          }),
        );
      }

      for (const point of await dataPoints(
        accessToken,
        "daily-resting-heart-rate",
        `dailyRestingHeartRate.date >= "${fromDay}"`,
        1_000,
      )) {
        const record = asRecord(point.dailyRestingHeartRate);
        const day = record ? civilDate(record.date) : null;
        const bpm = record ? num(record, "beatsPerMinute") : null;
        const interval = dayInterval(day ?? "");
        if (!day || !interval || bpm === null) continue;
        intents.push(
          metricIntent("google_health", {
            externalId: `${recordId("google_health", "rhr", day)}-rhr`,
            canonicalType: "resting_heart_rate",
            sampledAt: interval.sampledAt,
            value: bpm,
            unit: "bpm",
          }),
        );
      }

      for (const point of await dataPoints(
        accessToken,
        "daily-heart-rate-variability",
        `dailyHeartRateVariability.date >= "${fromDay}"`,
        1_000,
      )) {
        const record = asRecord(point.dailyHeartRateVariability);
        const day = record ? civilDate(record.date) : null;
        const ms = record ? num(record, "averageHeartRateVariabilityMilliseconds") : null;
        const interval = dayInterval(day ?? "");
        if (!day || !interval || ms === null) continue;
        intents.push(
          metricIntent("google_health", {
            externalId: `${recordId("google_health", "hrv", day)}-hrv`,
            canonicalType: "hrv_rmssd",
            sampledAt: interval.sampledAt,
            value: ms,
            unit: "ms",
          }),
        );
      }

      for (const point of await dataPoints(
        accessToken,
        "sleep",
        `sleep.interval.end_time >= "${from}" AND sleep.interval.end_time < "${to}"`,
        25,
      )) {
        const sleep = asRecord(point.sleep);
        const interval = sleep ? asRecord(sleep.interval) : null;
        const start = interval ? utcIso(interval.startTime) : null;
        const end = interval ? utcIso(interval.endTime) : null;
        const name = str(point, "name");
        if (!sleep || !start || !end || !name) continue;
        intents.push(
          sleepIntent("google_health", {
            externalId: recordId("google_health", "sleep", name.split("/").pop() ?? name),
            start,
            end,
            sourceDevice: "wearable",
            lastModifiedAt: utcIso(sleep.updateTime),
          }),
        );
      }
      return intents;
    },

    async revoke({ accessToken, refreshToken }) {
      await requestJson(deps, "google_health", urls.revoke, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Revoking the refresh token also revokes its access tokens.
        body: new URLSearchParams({ token: refreshToken ?? accessToken }),
      });
    },
  };
}
