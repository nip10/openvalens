# Wearables

Wearable data reaches OpenValens **through the phone first**. The mobile
companion reads HealthKit (iOS) and Health Connect (Android) and sends steps,
heart rate, sleep, weight and workouts with no vendor account at all. That path
is always on and needs none of this page.

The **cloud adapters** below are optional and additive. They exist only for
what the phone cannot carry — overnight HRV and the vendor's own scores
(Readiness, Recovery, Nightly Recharge) — or for people who do not run the
companion. Each adapter uses **your own** developer app registered with the
vendor; there are no shared OpenValens credentials and no aggregator in the
health-data path.

- With no `WEARABLES_*` variables set, nothing changes: the adapters are `off`,
  the readiness probe reports each vendor `off`, and `wearables.list` is empty.
- When a vendor _is_ configured, a day with both phone and cloud data for the
  same metric is **counted once** (the phone row wins; see below).

## Connecting a device (for members)

Connecting happens in the **web app**: **Settings → Integrations → Devices**
(`/settings/devices`). The page lists only the vendors this server's operator
has configured; with none configured it says so and nothing else changes.

For each vendor it shows the connection state (not connected, connected,
reconnect needed, access revoked), the last successful sync and, after a
failure, a short value-free reason. The actions are:

- **Connect** / **Reconnect** opens the vendor's consent page in the same
  browser tab. The vendor sends the browser to this server's callback, which
  binds the grant to the browser's signed-in session and returns to
  `/settings/devices?provider=<id>&status=<connected|denied|failed|unauthenticated>`;
  the page turns that into a notice. `unauthenticated` means the browser that
  finished the consent was not signed in — sign in there and connect again.
- **Sync now** asks for a sync on the next scheduled pass (or webhook run).
- **Disconnect** asks whether to keep or delete the records the connection
  already brought in, then revokes upstream and deletes the stored tokens.
- After a vendor revokes access, **Keep records** or **Delete records**
  resolves the held-back rows (deleting asks for confirmation). Reconnecting
  the same vendor account instead restores them.

The mobile app shows the same status under **Settings → Integrations →
Devices** and can request a sync, but connecting, disconnecting and the
keep-or-delete choice are web-only: the callback needs the session cookie of
the browser that completes the consent, and the app keeps its session in
secure storage the system browser cannot see.

Days with overnight HRV (`hrv_rmssd`) show the latest value on the **Vitals**
page. Vendor scores (`provider_score`) are stored but not yet displayed.

## Enabling a provider

For each vendor: register a developer app, then set its client id and secret.
The secret supports the `_FILE` suffix (Docker secrets). The full variable list
is in the [environment reference](reference/env.md); on a Compose install add
them to the `deploy/.env` table in
[self-hosting configuration](self-hosting/configuration.md).

```
WEARABLES_OURA_CLIENT_ID=...
WEARABLES_OURA_CLIENT_SECRET=...            # or WEARABLES_OURA_CLIENT_SECRET_FILE
```

The callback returns the browser to `CORS_ORIGIN` + `/settings/devices`, so
`CORS_ORIGIN` must be the web app's public origin.

Register this **redirect URI** with every vendor (replace the host):

```
https://<your-host>/api/integrations/wearables/<provider>/callback
```

`<provider>` is one of `oura`, `whoop`, `polar`, `withings`, `google_health`.
The Google adapter stays off even with credentials until you also set
`WEARABLES_GOOGLE_HEALTH_ENABLED=true` (the API is in public preview).

| Provider        | Scopes requested                                                                                                             | Webhook                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `oura`          | `personal daily`                                                                                                             | `x-oura-signature` (HMAC-SHA256)            |
| `whoop`         | `offline read:recovery read:sleep read:profile`                                                                              | `X-WHOOP-Signature` (base64 HMAC-SHA256)    |
| `polar`         | `accesslink.read_all`                                                                                                        | `Polar-Webhook-Signature` (hex HMAC-SHA256) |
| `withings`      | `user.metrics,user.activity`                                                                                                 | unsigned form post (subscribe on connect)   |
| `google_health` | `https://www.googleapis.com/auth/googlehealth.{activity_and_fitness,health_metrics_and_measurements,sleep,profile}.readonly` | none — polling only                         |

## Webhooks and polling

Webhooks are **optional**. Cloud connections are synced by a scheduled job
(`cron.wearablesSync`, suggested every 15 minutes) that claims due connections
with `FOR UPDATE SKIP LOCKED`, so overlapping runs never sync one twice. That
poller is the fallback for any instance without public HTTPS ingress.

Set `WEARABLES_WEBHOOKS=true` to also have vendors call back:

```
https://<your-host>/api/integrations/wearables/<provider>/webhook
```

The delivery is answered only after its signature verifies; the queued sync
runs immediately afterwards (WHOOP expects a fast 2xx). Signature secrets:

- Oura and WHOOP sign with the client secret (`WEARABLES_OURA_CLIENT_SECRET`,
  `WEARABLES_WHOOP_CLIENT_SECRET`).
- Polar signs with the `signature_secret_key` returned when you create the
  AccessLink webhook — set `WEARABLES_POLAR_WEBHOOK_SECRET`. Without it, Polar
  webhooks are refused and Polar is polled.
- Withings notifications are unsigned form posts, so they are treated as a
  hint only: data is re-read with the stored token, and an unlink is believed
  only after Withings itself rejects the grant.

Oura needs a verification token when you create its webhook subscription; ask
the server operator to compute `ouraVerificationToken(WEARABLES_OURA_CLIENT_SECRET)`
(the value exported by `@openvalens/wearables`).

## What each adapter sends

Every adapter maps its vendor payload to the existing canonical metric/event
taxonomy and goes through the normal ingestion pipeline, with vendor + vendor
record id provenance. The raw artifact is trimmed to the mapped fields; no
adapter logs a token, vendor payload or health value.

| Provider        | Adds beyond the phone                                                       |
| --------------- | --------------------------------------------------------------------------- |
| `oura`          | Readiness score, overnight HRV, resting heart rate, sleep, daily steps      |
| `whoop`         | Recovery score, overnight HRV, resting heart rate, sleep (unscored skipped) |
| `polar`         | Nightly Recharge status, overnight HRV, sleep nights                        |
| `withings`      | Weight, body fat, sleep summaries                                           |
| `google_health` | Daily steps, weight, resting heart rate, daily HRV, sleep                   |

## Deduplication (phone-first)

Most wearables already write steps, weight, resting heart rate and sleep to
HealthKit / Health Connect, which the companion sends as `mobile_ingest`. When
a cloud adapter brings the same thing (`wearable_cloud`):

- **Metrics** (`steps`, `weight`, `body_fat`, `resting_heart_rate`): a UTC day
  with an active phone row hides that day's cloud rows for the same metric.
- **Sleep**: a cloud session is hidden when an active phone session overlaps at
  least half of the shorter of the two.

Hiding sets `superseded_at` and records a `shadowed_by_phone_source` link, so
the rule undoes itself: when the phone row is deleted on the device, the
shadowed cloud row comes back. Cloud-only metrics (HRV, provider scores) are
never touched and no row is ever deleted by this rule.

## Disconnecting and quarantine

Disconnecting revokes the grant upstream (Polar de-registers the user;
Oura / WHOOP / Withings / Google revoke the token) and deletes the stored
tokens. You then choose whether the rows the connection brought in are kept or
deleted.

If a vendor tells us access was revoked (`*.deleted` / deauthorization), the
connection is **quarantined**: its tokens are dropped, its rows are hidden
pending a keep-or-delete choice, and `wearables.list` shows
`status: "quarantined"` with a `quarantinedRecordCount`. Reconnecting before
choosing restores the held-back rows.

## Google Health Testing mode

An **unverified** Google OAuth app in Testing mode issues refresh tokens that
expire after 7 days. When the refresh fails, the connection moves to
`reconnect_needed` (last error `reauthorization_required`) and the last synced
instant is kept, so reconnecting backfills the gap — there is no silent data
gap. Verify the OAuth app (or move to production mode) to remove the weekly
reconnect. See the [Google Health developer checklist](https://developers.google.com/health/developer-checklist).

## Data rights

Wearable OAuth links are covered by the instance's
[privacy and data-deletion](self-hosting/privacy.md) controls: tokens and the
OAuth `state` hash are never exported, and deleting a subject removes them with
the workspace.

---

Provider programs and model ids were last verified **2026-10-02** (issue #60);
adapter payload shapes follow the vendors' documented responses as checked
**2026-10-16**. Re-check provider programs and API versions before relying on
them, and update this date when you do.
