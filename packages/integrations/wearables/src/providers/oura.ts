import { createHmac, timingSafeEqual } from "node:crypto";

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
  WearableWebhookRejected,
  ymd,
  type WearableAdapter,
  type WearableEndpoints,
  type WearableHttpDeps,
  type WearableWebhookEvent,
} from "../adapter";
import { dayInterval, metricIntent, recordId, sleepIntent } from "../intents";

/**
 * Oura API v2 adapter (plain `fetch`). Docs: https://cloud.ouraring.com/v2/docs
 * (shapes checked 2026-10-16; no live call has been made).
 *
 * - OAuth authorization code; personal access tokens were retired in 2025.
 *   **Refresh tokens are single use**: the service refreshes under a row lock
 *   so two concurrent syncs never lose the rotated token.
 * - Reads `daily_readiness` (score), `sleep` (main `long_sleep` periods:
 *   session, average HRV, lowest heart rate) and `daily_activity` (steps).
 * - Webhooks: `x-oura-signature` is HMAC-SHA256 (hex) of
 *   `x-oura-timestamp` + raw body with the client secret. Events only hint a
 *   sync; `delete` events remove that record's rows.
 */

export type OuraEndpointKey = "authorize" | "token" | "revoke" | "api";

export const OURA_ENDPOINTS: WearableEndpoints<OuraEndpointKey> = {
  authorize: "https://cloud.ouraring.com/oauth/authorize",
  token: "https://api.ouraring.com/oauth/token",
  revoke: "https://api.ouraring.com/oauth/revoke",
  api: "https://api.ouraring.com",
};

export const OURA_SCOPES = "personal daily";

const DATA_KIND: Record<string, string> = {
  daily_readiness: "readiness",
  sleep: "sleep",
  daily_activity: "activity",
};

/** Verification token the operator registers with an Oura webhook subscription. */
export function ouraVerificationToken(clientSecret: string): string {
  return createHmac("sha256", clientSecret).update("openvalens:oura-webhook:v1").digest("hex");
}

export function createOuraAdapter(
  credentials: { clientId: string; clientSecret: string },
  deps: WearableHttpDeps & { endpoints?: Partial<WearableEndpoints<OuraEndpointKey>> },
): WearableAdapter {
  const urls = { ...OURA_ENDPOINTS, ...deps.endpoints };

  const token = async (values: Record<string, string>) =>
    parseTokenResponse(
      "oura",
      await requestJson(deps, "oura", urls.token, {
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

  /** Every page of one collection between two dates. */
  async function collection(accessToken: string, path: string, from: Date, to: Date) {
    const items: Record<string, unknown>[] = [];
    let nextToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query = new URLSearchParams({ start_date: ymd(from), end_date: ymd(to) });
      if (nextToken) query.set("next_token", nextToken);
      const body = asRecord(
        await requestJson(deps, "oura", `${urls.api}/v2/usercollection/${path}?${query}`, {
          headers: bearer(accessToken),
        }),
      );
      if (!body) throw new WearableProviderError("oura", "invalid_response", 200);
      for (const item of asArray(body.data)) {
        const record = asRecord(item);
        if (record) items.push(record);
      }
      nextToken = str(body, "next_token");
      if (!nextToken) break;
    }
    return items;
  }

  return {
    id: "oura",
    scopes: OURA_SCOPES,
    refreshes: true,

    authorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: OURA_SCOPES,
        state,
      });
      return `${urls.authorize}?${query}`;
    },

    exchangeCode: ({ code, redirectUri }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),

    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async identify(tokens) {
      const body = asRecord(
        await requestJson(deps, "oura", `${urls.api}/v2/usercollection/personal_info`, {
          headers: bearer(tokens.accessToken),
        }),
      );
      const id = body ? str(body, "id") : null;
      if (!id) throw new WearableProviderError("oura", "invalid_response", 200);
      return id;
    },

    async fetchRecords({ accessToken, window }) {
      const intents: CanonicalWriteIntent[] = [];
      for (const item of await collection(accessToken, "daily_readiness", window.from, window.to)) {
        const id = str(item, "id");
        const interval = dayInterval(str(item, "day") ?? "");
        const score = num(item, "score");
        if (!id || !interval || score === null) continue;
        intents.push(
          metricIntent("oura", {
            externalId: `${recordId("oura", "readiness", id)}-score`,
            canonicalType: "provider_score",
            sampledAt: interval.sampledAt,
            value: score,
            unit: "score",
            detail: { scoreKind: "oura_readiness" },
          }),
        );
      }
      for (const item of await collection(accessToken, "sleep", window.from, window.to)) {
        const id = str(item, "id");
        const start = utcIso(item.bedtime_start);
        const end = utcIso(item.bedtime_end);
        // Naps and rest periods are skipped; the main sleep carries HRV.
        if (!id || !start || !end || str(item, "type") !== "long_sleep") continue;
        const base = recordId("oura", "sleep", id);
        intents.push(sleepIntent("oura", { externalId: base, start, end, sourceDevice: "ring" }));
        const hrv = num(item, "average_hrv");
        if (hrv !== null)
          intents.push(
            metricIntent("oura", {
              externalId: `${base}-hrv`,
              canonicalType: "hrv_rmssd",
              sampledAt: end,
              value: hrv,
              unit: "ms",
            }),
          );
        const resting = num(item, "lowest_heart_rate");
        if (resting !== null)
          intents.push(
            metricIntent("oura", {
              externalId: `${base}-rhr`,
              canonicalType: "resting_heart_rate",
              sampledAt: end,
              value: resting,
              unit: "bpm",
            }),
          );
      }
      for (const item of await collection(accessToken, "daily_activity", window.from, window.to)) {
        const id = str(item, "id");
        const interval = dayInterval(str(item, "day") ?? "");
        const steps = num(item, "steps");
        if (!id || !interval || steps === null) continue;
        intents.push(
          metricIntent("oura", {
            externalId: `${recordId("oura", "activity", id)}-steps`,
            canonicalType: "steps",
            ...interval,
            value: steps,
            unit: "count",
          }),
        );
      }
      return intents;
    },

    async revoke({ accessToken }) {
      await requestJson(
        deps,
        "oura",
        `${urls.revoke}?${new URLSearchParams({ access_token: accessToken })}`,
        { method: "POST" },
      );
    },

    parseWebhook({ headers, rawBody }) {
      const signature = headers.get("x-oura-signature") ?? "";
      const timestamp = headers.get("x-oura-timestamp") ?? "";
      const expected = createHmac("sha256", credentials.clientSecret)
        .update(timestamp + rawBody)
        .digest("hex");
      const given = Buffer.from(signature.toLowerCase());
      if (
        !timestamp ||
        given.length !== expected.length ||
        !timingSafeEqual(given, Buffer.from(expected))
      )
        throw new WearableWebhookRejected("signature");
      let body: Record<string, unknown> | null;
      try {
        body = asRecord(JSON.parse(rawBody));
      } catch {
        throw new WearableWebhookRejected("malformed");
      }
      const userId = body ? str(body, "user_id") : null;
      const kind = body ? DATA_KIND[str(body, "data_type") ?? ""] : undefined;
      if (!body || !userId || !kind) return [];
      const objectId = str(body, "object_id");
      const events: WearableWebhookEvent[] = [];
      if (str(body, "event_type") === "delete" && objectId)
        events.push({
          kind: "record_deleted",
          externalUserId: userId,
          externalRecordId: recordId("oura", kind, objectId),
        });
      else events.push({ kind: "data_changed", externalUserId: userId });
      return events;
    },
  };
}
