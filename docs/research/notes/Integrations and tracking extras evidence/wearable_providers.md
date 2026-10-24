# Wearable / health data provider cloud APIs for a self-hosted AGPL health app (OpenValens), as of October 2026

Scope note: research done 2026-10-02. About 20 search/fetch calls. Primary sources are used where they could be fetched. Where only a vendor or aggregator blog (Terra, Open Wearables, Thryve, Sahha) was available, this is flagged. Those blogs come from companies that sell competing aggregation, so their framing may be biased.

## Q1. Per-provider access requirements, OAuth, rate limits, webhooks, data, terms

### Takeaway

Ticket #60's claim that "all have free, well-documented APIs" is **false as of October 2026**:

- **Garmin**: new developer applications are paused. Even when open, it was companies only, by application.
- **Fitbit**: the Fitbit Web API shuts off on **2026-10-30**. Its replacement is the Google Health API.
- **Suunto** and **Samsung**: partner-approval programs that exclude personal use.
- **Strava**: free, but limited to "single-player" mode until Strava reviews the app. It also bans AI/ML use of its data.

Realistic self-serve options are Oura (OAuth only now), Withings, Polar AccessLink and Whoop (dev mode capped at 10 members). Google Health API is a maybe.

### Cited Findings

**Garmin (Connect Developer Program / Health API)**

- Garmin staff on the official developer forum (post about 4 months before Oct 2026, so roughly June 2026): "The application form for new API access requests is currently unavailable while we complete updates to the Garmin Connect Developer Program… During this transition, new access requests are temporarily paused." No reopening date was given. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/434798/cannot-access-developer-program-application-form-under-construction)
- By spring 2026 the application form had been replaced with an "Under Construction" notice. Existing approved integrations have not been shut down. — [Terra blog (secondary)](https://tryterra.co/blog/garmin-connect-developer-program-pause)
- The program agreement lets Garmin add API fees on 30 days' notice and charge for excessive request volume. "Enhanced" HRV data needs a commercial license fee. — [Terra blog (secondary)](https://tryterra.co/blog/garmin-connect-developer-program-pause)
- Requirements:
  - Applicants must be a registered legal entity (company or institution) with a public website and privacy policy.
  - Self-hosters must obtain their own Garmin credentials.
  - Delivery is by push webhook to one endpoint for all data types.
  - Backfill typically returns about the last month, and each data type can usually be backfilled only once.
  - Source: [Open Wearables Garmin docs](https://openwearables.io/docs/providers/garmin-api-integration)
- Secondary sources claim a one-time USD 5,000 production fee and about 2 business days of review. **Unverified.** The Terra article does not mention the $5,000, and I could not read a primary Garmin source for it. — [search summary of Lovable/rapidevelopers and Spike blogs](https://www.spikeapi.com/blog/why-integrate-garmin-api-directly)

**Fitbit to Google Health API**

- Legacy Fitbit Web API dates: support ends **2026-09-30** ("Google will no longer fix bugs or provide API support"). The API is **turned off on 2026-10-30**. — [Google Health API release notes](https://developers.google.com/health/release-notes)
- Google Health API: v4 launched 2026-03-24, and a v4beta "public preview for broad partner testing" started 2026-10-01. — [Google Health API release notes](https://developers.google.com/health/release-notes)
- Google Health API features:
  - OAuth2 through Google Cloud Console, with read/write scopes.
  - Data types: activity, heart rate, weight/body fat, blood glucose, ECG, temperature, women's health, sleep, nutrition.
  - Webhooks with retry "for up to 7 days".
  - Specific rate limits are not given in the release notes.
  - Source: [Google Health API release notes](https://developers.google.com/health/release-notes)
- Existing Fitbit OAuth tokens do not carry over. Every user must re-consent through Google OAuth. — [Terra migration blog](https://tryterra.co/blog/fitbit-api-shutdown-september-2026-migration); [Momentum blog](https://www.themomentum.ai/blog/fitbit-web-api-deprecation-google-health-migration)
- New Fitbit Web API registrations are already closed. The old API was limited to 150 requests/hour/user and was pull-based. — [Open Wearables blog (secondary)](https://openwearables.io/blog/fitbit-web-api-shutdown-2026-migration-guide)
- Home Assistant opened issue #45291 on 2026-05-10 to update its Fitbit integration docs. The docs currently tell users to create their own Fitbit developer app (bring-your-own credentials). — [home-assistant.io #45291](https://github.com/home-assistant/home-assistant.io/issues/45291)

**Oura (API v2)**

- Personal access tokens were deprecated in December 2025 and new ones can't be created, so OAuth2 is the only path. Several independent OSS projects confirm this:
  - a PR replacing PAT with OAuth2 ([mr-bridge-assistant PR #732](https://github.com/Theioz/mr-bridge-assistant/pull/732))
  - [oura-mcp](https://github.com/HalmSascha/oura-mcp) ("OAuth2 only, self-hosted")
  - [stethoscope.js docs](https://stethoscope.js.org/docs/integrations/oura-ring/)
  - I could not render the primary docs page: [cloud.ouraring.com/v2/docs](https://cloud.ouraring.com/v2/docs)
- Refresh tokens are single-use: each refresh returns a new one and invalidates the old one. — [search summary citing Oura integration writeups](https://www.aifitnessapi.com/integrate/oura-api) (secondary)

**Withings**

- Standard public API limit: 120 requests/minute per application. An Enterprise plan unlocks higher limits. — [search summary; Withings developer guide](https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-overview/)
- Withings has a notification system: it POSTs to your callback URL when new data is ready, then you fetch the data. — [Withings Notifications overview](https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-overview/)
- Throttled requests return envelope status 601. — [open-wearables issue #1724](https://github.com/the-momentum/open-wearables/issues/1724)

**Strava**

- New apps start in "single-player mode", where only your own Strava account can authenticate. — [Strava Getting Started](https://developers.strava.com/docs/getting-started/)
- After setup, an app can move to athlete capacity 10. Beyond 10 athletes it must be submitted for review. — [Strava Getting Started](https://developers.strava.com/docs/getting-started/)
- Rate limits: 200 requests/15 min and 2,000/day by default, and 400/15 min and 4,000/day once upgraded. — [Strava Getting Started](https://developers.strava.com/docs/getting-started/)
- The API terms require webhooks to detect when an athlete deauthorizes the app and to track activity privacy changes. — [Strava Getting Started](https://developers.strava.com/docs/getting-started/)
- API Agreement update effective **2024-11-11** (older than 2025, but still the standing terms as far as I found):
  - Third-party apps may display a user's Strava activity data only to that user.
  - Data from the API may not be used "in artificial intelligence models or similar applications".
  - New terms protect Strava's look and feel.
  - Source: [Strava press](https://press.strava.com/articles/updates-to-stravas-api-agreement)
- Search snippets mention 2025–2026 API tightening ahead of Strava's IPO, including a monthly fee. **Unverified.** The TechRepublic page returned 403 and the snippet came from a crypto-news aggregator. — [TechRepublic (not readable)](https://www.techrepublic.com/article/news-strava-api-scraping-crackdown/)

**Polar AccessLink (v3)**

- Any registered Polar Flow user can create an API client in the admin portal. No fee is stated. — [Polar AccessLink](https://www.polar.com/accesslink-api/)
- Auth and rate limits:
  - OAuth2.
  - 15-minute limit: 500 + 20 × users.
  - 24-hour limit: 5,000 + 100 × users.
  - Over the limit returns HTTP 429.
  - Source: [Polar AccessLink](https://www.polar.com/accesslink-api/)
- Delivery and data:
  - Data arrives through pull notifications or webhooks.
  - Data types: exercises (FIT/TCX/GPX), daily activity, continuous HR (5-min), cardio load, sleep/Sleep Plus Stages, Nightly Recharge, SleepWise, Elixir biosensing (temperature, ECG, SpO2).
  - A DELETE de-register endpoint revokes the user's token.
  - Source: [Polar AccessLink](https://www.polar.com/accesslink-api/)

**Whoop (API v2)**

- Access:
  - Development access is limited to 10 WHOOP members. Going beyond that needs app approval.
  - Developers must own a WHOOP device.
  - Access is currently free.
  - Sources: [WHOOP Getting Started](https://developer.whoop.com/docs/developing/getting-started/) and search summary
- Default rate limits are 100 requests/min and 10,000/day. Increases can be requested. — [WHOOP Rate Limiting](https://developer.whoop.com/docs/developing/rate-limiting/)
- Webhooks:
  - Events: recovery/sleep/workout `.updated` and `.deleted`.
  - Signature validation is required.
  - Return 2XX within about 1 second.
  - Source: [WHOOP Webhooks](https://developer.whoop.com/docs/developing/webhooks/)
- WHOOP explicitly says to "follow its design guidelines" (branding). — [WHOOP Getting Started](https://developer.whoop.com/docs/developing/getting-started/)

**Suunto**

- Access is through the partner program application. A reply comes within about 2 weeks, and the API agreement is provided on acceptance.
- Suunto grants access to companies and organisations building tools for commercial or non-commercial use, but **"do not provide this for personal use."**
- Source: [Suunto API Zone FAQ](https://apizone.suunto.com/faq) (via search summary)

**Samsung Health**

- There is no cloud API. The Samsung Health Data SDK runs on-device on Android.
- Distribution requires Samsung partner approval and registering the app's package name plus SHA-256 signature.
- Approvals for the legacy SDK do not carry over.
- Sources: [Samsung app verification](https://developer.samsung.com/health/data/guide/app-verification.html); [Samsung migration guide](https://developer.samsung.com/health/data/migration-guide/overview.html)

### Inferences

- For v1, Garmin and Fitbit-legacy should be dropped from the server-side adapter list. Garmin can't be applied for, and Fitbit-legacy dies 2026-10-30, which is four weeks away. The Fitbit adapter should target the Google Health API, or rely on Health Connect/HealthKit.
- Strava is a poor fit for a health cockpit with AI review features. Its AI clause conflicts with sending Strava-sourced data to the app's Anthropic-backed AI features. Any Strava data would need an "AI-excluded" provenance flag.
- Oura, Polar and Withings are the cleanest server-side candidates. Whoop is also workable for personal use: the 10-member dev cap is enough for a single self-hoster.

### Gaps

- Garmin: no primary source for the $5,000 fee or the exact suspension date.
- Google Health API: whether production use of its health scopes needs Google OAuth app verification or a restricted-scope security assessment (CASA), and whether individuals can pass it. I did not read the app-verification page.
- Oura: the user cap for unapproved OAuth apps, rate limits, webhook details, and whether an Oura membership is required. The primary docs did not render.
- Withings: whether individuals can register on the free public API tier, and the exact terms. These were not read directly.
- Strava 2025–2026 changes (fees, IPO-era tightening) could not be verified from a primary source.
- Retention and deletion clauses in each provider's API agreement: Strava requires deauthorization webhooks, but I did not read the full agreements.

## Q2. Self-hosting model: can each self-hoster register their own credentials? What do comparable OSS projects do?

### Takeaway

The workable OSS pattern is **bring-your-own developer credentials**: each self-hoster registers their own app. Home Assistant (Fitbit) and Open Wearables (Garmin and others) both do this. It works for Oura, Withings, Polar, Whoop (≤10 members) and Strava (single-player). It does not work for Garmin or Suunto, which require a legal entity or refuse personal use. Unofficial Garmin scraping libraries broke in March 2026.

### Cited Findings

- Open Wearables:
  - MIT-licensed and self-hosted (Docker Compose; FastAPI, Postgres, Redis, Celery).
  - Integrates Garmin, Polar, Whoop, Strava, Apple Health, Samsung Health, Health Connect, Suunto, Oura and Fitbit.
  - Sources: [Open Wearables compare](https://openwearables.io/compare)
  - For Garmin, self-hosters must apply for their own Garmin developer access as a legal entity. — [Open Wearables Garmin docs](https://openwearables.io/docs/providers/garmin-api-integration)
- Home Assistant's Fitbit integration tells users to create their own app in the Fitbit developer portal (bring-your-own credentials). The docs need updating for the Google Health API move. — [HA issue #45291](https://github.com/home-assistant/home-assistant.io/issues/45291)
- Community Oura projects for self-hosting have moved to OAuth2 with local redirects, since PATs are gone:
  - [oura-mcp](https://github.com/HalmSascha/oura-mcp)
  - [Mimir PR #10](https://github.com/LucaGuiga/Mimir_timeManagement/pull/10)
  - [Oura HA integration v2.10.0](https://github.com/louispires/Oura-Home-Assistant-Integration/releases/tag/v2.10.0)
- Unofficial Garmin libraries:
  - In March 2026 Garmin changed authentication and added Cloudflare TLS fingerprinting that blocks non-browser HTTP clients.
  - `garth` was deprecated, with its final release on 2026-03-28.
  - `python-garminconnect` 0.3.x dropped garth.
  - Some projects now drive a headless Playwright browser.
  - Sources: [garth repo](https://github.com/matin/garth); [python-garminconnect](https://github.com/cyberjunky/python-garminconnect); [python-garminconnect #439](https://github.com/cyberjunky/python-garminconnect/issues/439); [garmin-connect-mcp](https://github.com/etweisberg/garmin-connect-mcp)

### Inferences

- Using unofficial Garmin scraping in an AGPL project carries ToS risk, and it is fragile: it was broken by a single Garmin change in 2026. Don't ship it as a supported v1 path. At most, offer it as an opt-in community plugin.
- A "central hosted instance holds credentials" model doesn't fit a self-hosted app. Self-hosters would have to route tokens through someone else's server, which breaks the PHI posture. So v1 docs need a per-provider "register your own app" walkthrough. A callback URL needs a publicly reachable HTTPS host, which webhooks also require.

### Gaps

- I did not check wger, Gadgetbridge, intervals.icu or GarminDB individually. Gadgetbridge is known to bypass vendor clouds by pairing devices directly over BLE, but I did not verify current device support in this session.
- I did not find Garmin's exact ToS wording on scraping.

## Q3. Which providers already write to HealthKit/Health Connect, and what is lost?

### Takeaway

Garmin, Oura and Whoop write basic data to Apple Health and Health Connect: steps, HR, sleep (Garmin includes stages), workouts and SpO2. The **HRV and proprietary scores are mostly lost**: HRV Status, Readiness, Recovery and Body Battery. On-device aggregation covers v1 basics without any cloud API.

### Cited Findings

- Garmin syncs sleep duration and stages, steps, HR, calories, workouts, weight and SpO2 to Health Connect. HRV Status stays in Garmin Connect. — [Constant blog](https://trainconstant.com/blog/garmin-apple-health); [Sonar Health](https://www.sonarhealth.co/blog/sync-health-connect-to-garmin/) (secondary)
- Garmin added sleep-stage sync to Apple Health in Sept 2023 (older source). — [gadgetsandwearables](https://gadgetsandwearables.com/2023/09/14/garmin-connect-sleep-stage-sync-apple-health/)
- Whoop's write permissions cover Active Energy, SpO2, HR, Respiratory Rate, Resting HR, Sleep and Workouts. HRV is not written. — [Terra/Medium](https://tryterra.co/blog/whoop-syncs-health-data-to-apple-health-ee298d328f41); [Constant](https://trainconstant.com/blog/whoop-apple-health)
- Oura writes sleep, HR, steps, active energy, respiratory rate, workouts, mindful minutes, height and weight to Apple Health, but not HRV. Oura Readiness, WHOOP Recovery and Garmin Body Battery never reach Apple Health. — [sensai.fit (secondary)](https://www.sensai.fit/blog/wearable-apple-health-integration-what-syncs-oura-whoop-garmin)
- Fitbit data can be reached on-device through Health Connect/Apple Health, which avoids Google cloud OAuth but requires a mobile app. — [Open Wearables blog](https://openwearables.io/blog/fitbit-web-api-shutdown-2026-migration-guide)

### Inferences

- With an existing companion app, v1 can cover Garmin, Oura, Whoop, Fitbit, Samsung (through Health Connect) and Withings basics on-device. The case for cloud adapters comes down to HRV, provider scores, richer sleep data and FIT files. Oura and Whoop cloud APIs are the best value for that.

### Gaps

- These sync matrices come from vendor-adjacent blogs, not the providers' own documentation, so per-type coverage changes over time. I have not verified Polar, Suunto or Withings writer coverage.

## Q4. Commercial and open-source aggregators

### Takeaway

The commercial aggregators (Terra, ROOK, Thryve, Junction) are per-tenant SaaS starting at about $300–$500 per month. That pricing, plus third-party processing of PHI, doesn't fit a self-hosted personal app. Open Wearables (MIT) is the relevant open-source aggregator. It still requires each deployer's own provider credentials.

### Cited Findings

- Terra: from $399/month billed annually ($499 monthly), including 100k credits. An active auth costs 200 credits/month. — [Terra pricing](https://tryterra.co/pricing) (via search summary)
- ROOK: Core plan $399/month for 750 users, with add-ons. — [sahha.ai comparison (secondary, competitor)](https://sahha.ai/compare/terra-alternatives/)
- Junction (formerly Vital): no published price. The legacy Vital page lists $0.50/user/month with a $300 minimum. — [aifitnessapi comparison (secondary)](https://aifitnessapi.com/alternatives/terra-alternatives)
- Thryve: free trial for 25 users, then from about EUR 499/month for 500 users. — search summary of comparison tables (secondary, unverified)
- Open Wearables is MIT-licensed, which is compatible with including or wrapping it in AGPL. It charges no per-user fee. — [Open Wearables compare](https://openwearables.io/compare)

### Inferences

- A self-hoster can't be expected to buy a Terra or ROOK contract. Aggregators would also be data processors for PHI, which needs a DPA. Studying or adapting Open Wearables provider adapters (MIT) is the more aligned option.

### Gaps

- I did not read the aggregators' ToS on redistribution or self-hosted resale. Pricing figures are from secondary comparison sites.

## Q5. Security and privacy obligations

### Takeaway

The obligations I could confirm:

- Handle deauthorization webhooks (Strava requires this).
- Validate webhook signatures (Whoop).
- Handle single-use rotating refresh tokens (Oura).
- Use explicit revoke/de-register endpoints on disconnect (Polar).
- Re-consent on platform migration (Fitbit to Google).

Token encryption at rest, deleting data on disconnect, and GDPR handling are good practice, but I did not read provider-specific contractual text requiring them.

### Cited Findings

- Strava requires webhooks to detect athlete deauthorization and privacy changes. — [Strava Getting Started](https://developers.strava.com/docs/getting-started/)
- Whoop webhooks need signature validation. It sends delete events (`*.deleted`) that should propagate deletions. — [WHOOP Webhooks](https://developer.whoop.com/docs/developing/webhooks/)
- Polar provides a DELETE de-register endpoint that revokes the user's token. — [Polar AccessLink](https://www.polar.com/accesslink-api/)
- Oura refresh tokens are single-use, so concurrent refreshes can lose the session. Token storage must be atomic. — [aifitnessapi Oura guide (secondary)](https://www.aifitnessapi.com/integrate/oura-api)
- Fitbit tokens don't migrate to Google OAuth, so users must re-consent. — [Terra migration blog](https://tryterra.co/blog/fitbit-api-shutdown-september-2026-migration)
- Garmin push webhooks need a public HTTPS endpoint (`/api/v1/garmin/webhooks/push` in Open Wearables). — [Open Wearables Garmin docs](https://openwearables.io/docs/providers/garmin-api-integration)

### Inferences

- The adapter framework needs:
  - encrypted, org-scoped token storage
  - an atomic refresh with a lock, to handle Oura's rotating tokens
  - a deauth/delete webhook handler that marks or quarantines provider-sourced records
  - a per-provider "AI-allowed" provenance flag, needed for Strava
  - a public webhook ingress, which self-hosters behind NAT may not have. Polling is the fallback for Polar, Withings, Oura and Whoop.

### Gaps

- I did not read data-retention and deletion-on-disconnect clauses in the Garmin, Oura, Withings, Polar or Whoop agreements. I also found no provider-specific GDPR text, so the exact deletion SLAs are unknown.
