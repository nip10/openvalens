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
  type WearableAdapter,
  type WearableEndpoints,
  type WearableHttpDeps,
  type WearableWebhookEvent,
} from "../adapter";
import { metricIntent, recordId, sleepIntent } from "../intents";

/**
 * WHOOP Developer API v2 adapter (plain `fetch`). Docs:
 * https://developer.whoop.com/api (shapes checked 2026-10-16; no live call).
 *
 * - OAuth authorization code with the `offline` scope for a refresh token.
 *   Development apps are limited to 10 members until WHOOP reviews them.
 * - Reads `recovery` (recovery score, resting heart rate, HRV RMSSD) and
 *   `activity/sleep` (non-nap sessions). Unscored records are skipped.
 * - Webhooks: `X-WHOOP-Signature` is base64 HMAC-SHA256 of
 *   `X-WHOOP-Signature-Timestamp` + raw body with the client secret; stale
 *   timestamps (over 5 minutes) are rejected. `*.updated` hints a sync and
 *   `*.deleted` removes that record's rows. The service answers at once and
 *   syncs afterwards (WHOOP expects a fast 2xx).
 */

export type WhoopEndpointKey = "authorize" | "token" | "api";

export const WHOOP_ENDPOINTS: WearableEndpoints<WhoopEndpointKey> = {
  authorize: "https://api.prod.whoop.com/oauth/oauth2/auth",
  token: "https://api.prod.whoop.com/oauth/oauth2/token",
  api: "https://api.prod.whoop.com/developer",
};

export const WHOOP_SCOPES = "offline read:recovery read:sleep read:profile";

const WEBHOOK_MAX_SKEW_MS = 5 * 60_000;

export function createWhoopAdapter(
  credentials: { clientId: string; clientSecret: string },
  deps: WearableHttpDeps & { endpoints?: Partial<WearableEndpoints<WhoopEndpointKey>> },
): WearableAdapter {
  const urls = { ...WHOOP_ENDPOINTS, ...deps.endpoints };

  const token = async (values: Record<string, string>) =>
    parseTokenResponse(
      "whoop",
      await requestJson(deps, "whoop", urls.token, {
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

  async function collection(accessToken: string, path: string, from: Date, to: Date) {
    const items: Record<string, unknown>[] = [];
    let nextToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query = new URLSearchParams({
        start: from.toISOString(),
        end: to.toISOString(),
        limit: "25",
      });
      if (nextToken) query.set("nextToken", nextToken);
      const body = asRecord(
        await requestJson(deps, "whoop", `${urls.api}/v2/${path}?${query}`, {
          headers: bearer(accessToken),
        }),
      );
      if (!body) throw new WearableProviderError("whoop", "invalid_response", 200);
      for (const item of asArray(body.records)) {
        const record = asRecord(item);
        if (record) items.push(record);
      }
      nextToken = str(body, "next_token");
      if (!nextToken) break;
    }
    return items;
  }

  return {
    id: "whoop",
    scopes: WHOOP_SCOPES,
    refreshes: true,

    authorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: WHOOP_SCOPES,
        state,
      });
      return `${urls.authorize}?${query}`;
    },

    exchangeCode: ({ code, redirectUri }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),

    refresh: (refreshToken) =>
      token({ grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" }),

    async identify(tokens) {
      const body = asRecord(
        await requestJson(deps, "whoop", `${urls.api}/v2/user/profile/basic`, {
          headers: bearer(tokens.accessToken),
        }),
      );
      const id = body ? str(body, "user_id") : null;
      if (!id) throw new WearableProviderError("whoop", "invalid_response", 200);
      return id;
    },

    async fetchRecords({ accessToken, window }) {
      const intents: CanonicalWriteIntent[] = [];
      for (const item of await collection(accessToken, "recovery", window.from, window.to)) {
        const sleepId = str(item, "sleep_id");
        const at = utcIso(item.created_at);
        const score = asRecord(item.score);
        if (!sleepId || !at || !score || str(item, "score_state") !== "SCORED") continue;
        const base = recordId("whoop", "recovery", sleepId);
        const lastModifiedAt = utcIso(item.updated_at);
        const add = (
          suffix: string,
          canonicalType: "provider_score" | "resting_heart_rate" | "hrv_rmssd",
          value: number | null,
          unit: string,
        ) => {
          if (value === null) return;
          intents.push(
            metricIntent("whoop", {
              externalId: `${base}-${suffix}`,
              canonicalType,
              sampledAt: at,
              value,
              unit,
              lastModifiedAt,
              ...(canonicalType === "provider_score"
                ? { detail: { scoreKind: "whoop_recovery" } }
                : {}),
            }),
          );
        };
        add("score", "provider_score", num(score, "recovery_score"), "score");
        add("rhr", "resting_heart_rate", num(score, "resting_heart_rate"), "bpm");
        add("hrv", "hrv_rmssd", num(score, "hrv_rmssd_milli"), "ms");
      }
      for (const item of await collection(accessToken, "activity/sleep", window.from, window.to)) {
        const id = str(item, "id");
        const start = utcIso(item.start);
        const end = utcIso(item.end);
        if (!id || !start || !end || item.nap === true) continue;
        intents.push(
          sleepIntent("whoop", {
            externalId: recordId("whoop", "sleep", id),
            start,
            end,
            sourceDevice: "wearable",
            lastModifiedAt: utcIso(item.updated_at),
          }),
        );
      }
      return intents;
    },

    async revoke({ accessToken }) {
      await requestJson(deps, "whoop", `${urls.api}/v2/user/access`, {
        method: "DELETE",
        headers: bearer(accessToken),
      });
    },

    parseWebhook({ headers, rawBody, now }) {
      const signature = headers.get("x-whoop-signature") ?? "";
      const timestamp = headers.get("x-whoop-signature-timestamp") ?? "";
      const expected = createHmac("sha256", credentials.clientSecret)
        .update(timestamp + rawBody)
        .digest("base64");
      const given = Buffer.from(signature);
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(now.getTime() - Number(timestamp)) > WEBHOOK_MAX_SKEW_MS ||
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
      const type = body ? (str(body, "type") ?? "") : "";
      const id = body ? str(body, "id") : null;
      if (!userId) return [];
      const [kind, action] = type.split(".");
      if (kind !== "recovery" && kind !== "sleep") return [];
      const events: WearableWebhookEvent[] = [];
      if (action === "deleted" && id)
        events.push({
          kind: "record_deleted",
          externalUserId: userId,
          externalRecordId: recordId("whoop", kind, id),
        });
      else if (action === "updated") events.push({ kind: "data_changed", externalUserId: userId });
      return events;
    },
  };
}
