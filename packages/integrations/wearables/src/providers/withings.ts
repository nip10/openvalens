import { createHmac } from "node:crypto";

import type { CanonicalWriteIntent } from "@openvalens/ingestion";

import {
  asArray,
  asRecord,
  bearer,
  expiresIn,
  num,
  requestJson,
  str,
  utcIso,
  WearableProviderError,
  ymd,
  type WearableAdapter,
  type WearableEndpoints,
  type WearableErrorCategory,
  type WearableHttpDeps,
  type WearableTokenSet,
  type WearableWebhookEvent,
} from "../adapter";
import { metricIntent, recordId, sleepIntent } from "../intents";

/**
 * Withings public API adapter (plain `fetch`). Docs:
 * https://developer.withings.com/api-reference (shapes checked 2026-10-16; no
 * live call).
 *
 * - Every call answers HTTP 200 with `{ status, body }`; a non-zero `status`
 *   is the error. Refresh tokens rotate on every refresh.
 * - Reads weight and body fat (`measure?action=getmeas`, types 1 and 6,
 *   `value × 10^unit`) and sleep summaries (`v2/sleep?action=getsummary`).
 * - Notifications are unsigned form posts (`userid`, `appli`), so they are
 *   only ever a hint: data is re-read with the stored token, and an unlink
 *   (`appli=46`) is believed only after Withings itself rejects the token.
 *   With `WEARABLES_WEBHOOKS=true` the adapter subscribes the callback URL for
 *   weight (1) and sleep (44) on connect.
 * - Revoke is a signed call: a nonce from `v2/signature?action=getnonce`,
 *   then `v2/oauth2?action=revoke`, both signed with HMAC-SHA256 of the
 *   comma-joined `action,client_id,(timestamp|nonce)` using the client secret.
 */

export type WithingsEndpointKey = "authorize" | "api";

export const WITHINGS_ENDPOINTS: WearableEndpoints<WithingsEndpointKey> = {
  authorize: "https://account.withings.com/oauth2_user/authorize2",
  api: "https://wbsapi.withings.net",
};

export const WITHINGS_SCOPES = "user.metrics,user.activity";

const NOTIFY_APPLI = ["1", "44"] as const;
const UNLINK_APPLI = "46";

function statusCategory(status: number, oauth: boolean): WearableErrorCategory {
  if (status === 601) return "rate_limited";
  if (status === 2554 || status === 2555 || status === 522) return "provider_unavailable";
  if ([100, 101, 102, 200, 401].includes(status))
    return oauth ? "reauthorization_required" : "auth";
  return oauth ? "reauthorization_required" : "rejected";
}

export function createWithingsAdapter(
  credentials: { clientId: string; clientSecret: string },
  deps: WearableHttpDeps & {
    endpoints?: Partial<WearableEndpoints<WithingsEndpointKey>>;
    now?: () => Date;
  },
): WearableAdapter {
  const urls = { ...WITHINGS_ENDPOINTS, ...deps.endpoints };
  const now = deps.now ?? (() => new Date());
  const sign = (...values: string[]) =>
    createHmac("sha256", credentials.clientSecret).update(values.join(",")).digest("hex");

  /** POST a form to a Withings service and unwrap `{ status, body }`. */
  async function call(
    path: string,
    values: Record<string, string>,
    options: { accessToken?: string; oauth?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const result = asRecord(
      await requestJson(deps, "withings", `${urls.api}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(options.accessToken ? bearer(options.accessToken) : {}),
        },
        body: new URLSearchParams(values),
        oauth: options.oauth,
      }),
    );
    const status = result ? num(result, "status") : null;
    if (status === null) throw new WearableProviderError("withings", "invalid_response", 200);
    if (status !== 0)
      throw new WearableProviderError(
        "withings",
        statusCategory(status, options.oauth ?? false),
        200,
        `status_${status}`,
      );
    return asRecord(result?.body) ?? {};
  }

  async function token(values: Record<string, string>): Promise<WearableTokenSet> {
    const body = await call(
      "/v2/oauth2",
      {
        action: "requesttoken",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        ...values,
      },
      { oauth: true },
    );
    const accessToken = str(body, "access_token");
    if (!accessToken) throw new WearableProviderError("withings", "invalid_response", 200);
    return {
      accessToken,
      refreshToken: str(body, "refresh_token"),
      expiresAt: expiresIn(body.expires_in, now().getTime()),
      scope: str(body, "scope"),
      externalUserId: str(body, "userid"),
    };
  }

  /** Every page of a paged Withings call (`more` / `offset`). */
  async function paged(
    path: string,
    values: Record<string, string>,
    accessToken: string,
    key: string,
  ) {
    const items: Record<string, unknown>[] = [];
    let offset: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const body = await call(path, { ...values, ...(offset ? { offset } : {}) }, { accessToken });
      for (const item of asArray(body[key])) {
        const record = asRecord(item);
        if (record) items.push(record);
      }
      const more = body.more === true || body.more === 1;
      offset = more ? str(body, "offset") : null;
      if (!offset) break;
    }
    return items;
  }

  return {
    id: "withings",
    scopes: WITHINGS_SCOPES,
    refreshes: true,

    authorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        scope: WITHINGS_SCOPES,
        state,
      });
      return `${urls.authorize}?${query}`;
    },

    exchangeCode: ({ code, redirectUri }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),

    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async identify(tokens) {
      if (!tokens.externalUserId)
        throw new WearableProviderError("withings", "invalid_response", 200);
      // Confirms the token is still accepted.
      await call("/v2/user", { action: "getdevice" }, { accessToken: tokens.accessToken });
      return tokens.externalUserId;
    },

    async onConnected({ accessToken, webhookUrl }) {
      if (!webhookUrl) return;
      for (const appli of NOTIFY_APPLI)
        await call(
          "/notify",
          { action: "subscribe", callbackurl: webhookUrl, appli },
          { accessToken },
        );
    },

    async fetchRecords({ accessToken, window }) {
      const intents: CanonicalWriteIntent[] = [];
      const groups = await paged(
        "/measure",
        {
          action: "getmeas",
          meastypes: "1,6",
          category: "1",
          startdate: String(Math.floor(window.from.getTime() / 1000)),
          enddate: String(Math.floor(window.to.getTime() / 1000)),
        },
        accessToken,
        "measuregrps",
      );
      for (const group of groups) {
        const grpid = str(group, "grpid");
        const date = num(group, "date");
        if (!grpid || date === null) continue;
        const sampledAt = new Date(date * 1000).toISOString();
        const modified = num(group, "modified");
        const lastModifiedAt = modified === null ? null : new Date(modified * 1000).toISOString();
        for (const item of asArray(group.measures)) {
          const measure = asRecord(item);
          const type = measure ? num(measure, "type") : null;
          const value = measure ? num(measure, "value") : null;
          const unit = measure ? num(measure, "unit") : null;
          if (value === null || unit === null) continue;
          const scaled = value * 10 ** unit;
          if (type === 1)
            intents.push(
              metricIntent("withings", {
                externalId: `${recordId("withings", "measure", grpid)}-weight`,
                canonicalType: "weight",
                sampledAt,
                value: scaled,
                unit: "kg",
                lastModifiedAt,
              }),
            );
          else if (type === 6)
            intents.push(
              metricIntent("withings", {
                externalId: `${recordId("withings", "measure", grpid)}-fat`,
                canonicalType: "body_fat",
                sampledAt,
                value: scaled,
                unit: "%",
                lastModifiedAt,
              }),
            );
        }
      }
      const series = await paged(
        "/v2/sleep",
        {
          action: "getsummary",
          startdateymd: ymd(window.from),
          enddateymd: ymd(window.to),
        },
        accessToken,
        "series",
      );
      for (const night of series) {
        const id = str(night, "id");
        const start = num(night, "startdate");
        const end = num(night, "enddate");
        if (!id || start === null || end === null) continue;
        const modified = num(night, "modified");
        intents.push(
          sleepIntent("withings", {
            externalId: recordId("withings", "sleep", id),
            start: new Date(start * 1000).toISOString(),
            end: new Date(end * 1000).toISOString(),
            sourceDevice: "wearable",
            lastModifiedAt: modified === null ? null : utcIso(modified * 1000),
          }),
        );
      }
      return intents;
    },

    async revoke({ externalUserId }) {
      const timestamp = String(Math.floor(now().getTime() / 1000));
      const nonceBody = await call("/v2/signature", {
        action: "getnonce",
        client_id: credentials.clientId,
        timestamp,
        signature: sign("getnonce", credentials.clientId, timestamp),
      });
      const nonce = str(nonceBody, "nonce");
      if (!nonce) throw new WearableProviderError("withings", "invalid_response", 200);
      await call("/v2/oauth2", {
        action: "revoke",
        client_id: credentials.clientId,
        nonce,
        signature: sign("revoke", credentials.clientId, nonce),
        userid: externalUserId,
      });
    },

    parseWebhook({ rawBody }) {
      // Unsigned: a hint only. The service re-reads with the stored token and
      // confirms an unlink against Withings before acting on it.
      const form = new URLSearchParams(rawBody);
      const userId = form.get("userid");
      const appli = form.get("appli");
      if (!userId || !/^\d+$/.test(userId)) return [];
      const events: WearableWebhookEvent[] = [];
      if (appli === UNLINK_APPLI) events.push({ kind: "deauthorized", externalUserId: userId });
      else if (appli && (NOTIFY_APPLI as readonly string[]).includes(appli))
        events.push({ kind: "data_changed", externalUserId: userId });
      return events;
    },
  };
}
