import { createHmac, timingSafeEqual } from "node:crypto";

import type { CanonicalWriteIntent } from "@openvalens/ingestion";

import {
  asArray,
  asRecord,
  basicAuth,
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
} from "../adapter";
import { dayInterval, inWindow, metricIntent, recordId, sleepIntent } from "../intents";

/**
 * Polar AccessLink v3 adapter (plain `fetch`). Docs:
 * https://www.polar.com/accesslink-api/ (shapes checked 2026-10-16; no live call).
 *
 * - Any Polar Flow user can register an AccessLink client. The token
 *   exchange uses HTTP Basic client authentication and returns the Polar user
 *   id (`x_user_id`). Tokens do not expire and there is no refresh grant.
 * - After connecting, the user must be **registered** with the client
 *   (`POST /v3/users`, 409 = already registered); disconnecting
 *   **de-registers** (`DELETE /v3/users/{id}`), which also revokes the token.
 * - Reads Nightly Recharge (status 1–6 as a provider score, overnight HRV)
 *   and sleep nights. Polar serves a rolling recent range, so records are
 *   filtered to the sync window here.
 * - Webhooks are per client: `Polar-Webhook-Signature` is hex HMAC-SHA256 of
 *   the raw body with the `signature_secret_key` Polar returns when the
 *   webhook is created (`WEARABLES_POLAR_WEBHOOK_SECRET`). Without it,
 *   webhooks are refused and polling is used.
 */

export type PolarEndpointKey = "authorize" | "token" | "api";

export const POLAR_ENDPOINTS: WearableEndpoints<PolarEndpointKey> = {
  authorize: "https://flow.polar.com/oauth2/authorization",
  token: "https://polarremote.com/v2/oauth2/token",
  api: "https://www.polaraccesslink.com",
};

export const POLAR_SCOPES = "accesslink.read_all";

export function createPolarAdapter(
  credentials: { clientId: string; clientSecret: string; webhookSecret: string | null },
  deps: WearableHttpDeps & { endpoints?: Partial<WearableEndpoints<PolarEndpointKey>> },
): WearableAdapter {
  const urls = { ...POLAR_ENDPOINTS, ...deps.endpoints };
  const json = (accessToken: string) => ({ ...bearer(accessToken), Accept: "application/json" });

  return {
    id: "polar",
    scopes: POLAR_SCOPES,
    refreshes: false,

    authorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: POLAR_SCOPES,
        state,
      });
      return `${urls.authorize}?${query}`;
    },

    async exchangeCode({ code, redirectUri }) {
      const tokens = parseTokenResponse(
        "polar",
        await requestJson(deps, "polar", urls.token, {
          method: "POST",
          headers: {
            Authorization: basicAuth(credentials.clientId, credentials.clientSecret),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json;charset=UTF-8",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
          oauth: true,
        }),
        "x_user_id",
      );
      // Polar tokens are long-lived; there is nothing to refresh.
      return { ...tokens, refreshToken: null, expiresAt: null };
    },

    async refresh() {
      throw new WearableProviderError("polar", "reauthorization_required");
    },

    async identify(tokens) {
      // The token response names the user; the user endpoint only answers
      // after registration (`onConnected`), so nothing is called here.
      if (!tokens.externalUserId) throw new WearableProviderError("polar", "invalid_response", 200);
      return tokens.externalUserId;
    },

    async onConnected({ accessToken, externalUserId }) {
      try {
        await requestJson(deps, "polar", `${urls.api}/v3/users`, {
          method: "POST",
          headers: { ...json(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify({ "member-id": `openvalens-${externalUserId}` }),
        });
      } catch (error) {
        // 409: already registered with this client, which is fine.
        if (!(error instanceof WearableProviderError && error.status === 409)) throw error;
      }
    },

    async fetchRecords({ accessToken, window }) {
      const intents: CanonicalWriteIntent[] = [];
      const recharge = asRecord(
        await requestJson(deps, "polar", `${urls.api}/v3/users/nightly-recharge`, {
          headers: json(accessToken),
        }),
      );
      for (const item of asArray(recharge?.recharges)) {
        const record = asRecord(item);
        const date = record ? str(record, "date") : null;
        const interval = dayInterval(date ?? "");
        if (!record || !date || !interval || !inWindow(interval.sampledAt, window)) continue;
        const base = recordId("polar", "recharge", date);
        const status = num(record, "nightly_recharge_status");
        if (status !== null)
          intents.push(
            metricIntent("polar", {
              externalId: `${base}-status`,
              canonicalType: "provider_score",
              sampledAt: interval.sampledAt,
              value: status,
              unit: "score",
              detail: { scoreKind: "polar_nightly_recharge_status" },
            }),
          );
        const hrv = num(record, "heart_rate_variability_avg");
        if (hrv !== null)
          intents.push(
            metricIntent("polar", {
              externalId: `${base}-hrv`,
              canonicalType: "hrv_rmssd",
              sampledAt: interval.sampledAt,
              value: hrv,
              unit: "ms",
            }),
          );
      }
      const sleep = asRecord(
        await requestJson(deps, "polar", `${urls.api}/v3/users/sleep`, {
          headers: json(accessToken),
        }),
      );
      for (const item of asArray(sleep?.nights)) {
        const record = asRecord(item);
        const date = record ? str(record, "date") : null;
        const start = record ? utcIso(record.sleep_start_time) : null;
        const end = record ? utcIso(record.sleep_end_time) : null;
        if (!date || !start || !end || !inWindow(end, window)) continue;
        intents.push(
          sleepIntent("polar", {
            externalId: recordId("polar", "sleep", date),
            start,
            end,
            sourceDevice: "watch",
          }),
        );
      }
      return intents;
    },

    async revoke({ accessToken, externalUserId }) {
      await requestJson(deps, "polar", `${urls.api}/v3/users/${externalUserId}`, {
        method: "DELETE",
        headers: json(accessToken),
      });
    },

    parseWebhook({ headers, rawBody }) {
      if (!credentials.webhookSecret) throw new WearableWebhookRejected("signature");
      const signature = (headers.get("polar-webhook-signature") ?? "").toLowerCase();
      const expected = createHmac("sha256", credentials.webhookSecret)
        .update(rawBody)
        .digest("hex");
      const given = Buffer.from(signature);
      if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected)))
        throw new WearableWebhookRejected("signature");
      let body: Record<string, unknown> | null;
      try {
        body = asRecord(JSON.parse(rawBody));
      } catch {
        throw new WearableWebhookRejected("malformed");
      }
      const userId = body ? str(body, "user_id") : null;
      if (!body || !userId || str(body, "event") === "PING") return [];
      return [{ kind: "data_changed", externalUserId: userId }];
    },
  };
}
