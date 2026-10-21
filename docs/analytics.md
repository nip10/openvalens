# Optional product analytics

Product analytics is off by default. The server sends nothing to PostHog unless
`ANALYTICS_ENABLED=true`, `POSTHOG_PROJECT_TOKEN` is set, the operator has
disabled IP capture in the actual PostHog EU project, and the user has opted in
through their own account preference. `POSTHOG_IP_CAPTURE_DISABLED=true` is an
operator attestation only: it does not change PostHog project settings. Do not
set it until IP capture has actually been disabled in that project. The endpoint
is fixed to `https://eu.i.posthog.com/i/v0/e/`; no host override is supported.
Use a project token, not a PostHog personal/admin API secret.

The only accepted event names are `preferences_opened`,
`appearance_control_used`, and `preferences_load_failed`. Payloads contain only
the event name, a fresh random distinct ID generated for that single event, and
`$process_person_profile: false`. That ID is never stored, reused, or linked to
an account, device, organization, or session. There are no health values,
preferences, routes, free text, headers, or request identifiers in event data.
Users have explicitly approved PostHog retaining each event and its ephemeral
ID. No client SDK, autocapture, replay, identify, alias, group, retry, queue, or
local event history is used.

The server does not forward the user's IP address, user agent, cookies, or
correlation IDs as event properties. PostHog can still observe the network IP of
the server making the request; this is not anonymous collection and must not be
described as such. Provider delivery is a single bounded request with no retry.

Consent is stored per user, defaulting to false. Each capture checks and locks
the user's current consent row immediately before dispatch. A capture already
ordered before a revocation commits can finish; the revocation waits for that
bounded in-flight dispatch, and no capture ordered after the committed
revocation is sent. A missing consent row, database error, unavailable
configuration, or provider failure prevents successful capture. Disabling
analytics is always allowed even while the provider is unavailable. Deleting a
user cascades their consent row; export includes the consent preference only.
Preference reads and writes report database failures as safe API errors rather
than substituting `false`; a write is acknowledged only after the database write
and authoritative readback succeed. If the optional analytics service is absent,
preference reads report unavailable/false, but preference writes fail rather
than claiming a durable change. Enabling while analytics is unavailable also
fails without writing an enabled preference.

Availability or a successful HTTP acknowledgement is not evidence that the
PostHog project has the promised privacy configuration. Operators must verify
the EU project's IP-capture setting independently before attesting.
