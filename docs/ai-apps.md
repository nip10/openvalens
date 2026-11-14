# Connected AI apps (MCP server and REST tool API)

Members can point an AI app (claude.ai, ChatGPT, Claude Code, Claude Desktop,
Cursor, a script or a local model) at their **own** records (Issue #439):
reading them, and, with an opt-in write scope, adding entries (see
[Writes](#writes)). Web connectors such as claude.ai and ChatGPT sign in with
**OAuth 2.1**; local clients can use OAuth too, or a **personal API key**.

## Turning it on

| Deployment  | Default | Switch              |
| ----------- | ------- | ------------------- |
| Self-hosted | off     | `MCP_ENABLED=true`  |
| Cloud       | on      | `MCP_ENABLED=false` |

With it off, `/api/mcp`, `/api/v1/tools/*`, the OAuth endpoints
(`/api/auth/oauth2/*`) and the OAuth well-known documents do not exist (404),
and readiness reports `mcp: off`. Rate limits:
`MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE` (60) and
`MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE` (120), per server process, answered
with `429` and `Retry-After`. Write limits: `MCP_WRITE_ENTRIES_PER_CALL` (100)
and `MCP_WRITE_ENTRIES_PER_DAY` (1,000 added per grant in any 24 hours). See
[configuration](self-hosting/configuration.md).

The workspace owner can turn **Members can connect AI apps** off (on by
default). Existing keys and connections in that workspace stop on their next
call. The switch is separate from the Coach AI switch, and the AI-app consent
(`mcp-v1`) is separate from Coach consent.

## Grants

Every key and every OAuth connection is a **grant** (`ai_app_grant`): one
member's own records in one workspace they own, with `records:read` plus any of
`nutrition:read`, `private_body:read`, `notes:read`, `trackers:read` and
`pain:read` (all off by default; a custom tracker with its own AI switch off
stays invisible, and the pain log needs its own AI switch on, which is off by
default),
and the `mcp-v1` consent. Revoking a grant, expiry, leaving the workspace,
losing ownership or the owner's switch stops the next call. Cycle data and
progress photos are never reachable (lint rule, allowlisted sources in
`packages/mcp/src/sources.ts`, and an integration test). A grant may also hold
write scopes (below), each off by default.

Each call keeps a light usage record (grant, tool, time, status, row count;
never arguments or results) for 90 days.

### Personal keys

- Keys start with `ov_`, are shown once and stored only as a SHA-256 digest.
  They expire after 30, 90 (default) or 365 days, or never. A member can hold
  at most ten active keys. Creating one sends a security email.

### OAuth connections

- Better Auth (`@better-auth/mcp` with `@better-auth/cimd`) is the
  authorization server. Approving an app on the consent screen creates an
  `ai_app_grant` of kind `oauth`; its consent, access tokens and refresh tokens
  carry that grant's id (`reference_id`), so every rule above applies exactly
  as for a key. Approving the same app again for the same workspace (for
  example after a `403 insufficient_scope`) updates that grant's scopes.
- **Tokens are opaque**, never JWTs: `ovat_…` access tokens last one hour;
  `ovrt_…` refresh tokens rotate on every use, with no reuse window, and expire
  after 90 days unused. Presenting a rotated refresh token again is treated as
  theft: the grant is revoked and the app has to be connected again.
- **Audience (RFC 8707):** every token is bound to `https://<server>/api/mcp`.
  A token for any other resource is refused, OAuth tokens are not accepted on
  the REST API, and the server never passes a token on to anything else.
- **Registration:** apps identify themselves preferably with a Client ID
  Metadata Document (CIMD; Claude and ChatGPT do), fetched over HTTPS through a
  transport that resolves the host once, refuses private, loopback and
  link-local addresses, pins the address and never follows redirects. Dynamic
  client registration (RFC 7591) also works, limited to 5 registrations a
  minute per IP; a registered app that never completes a connection is deleted
  after 24 hours.
- **Consent screen** (`/oauth/consent` on the web app): the app's own name,
  labelled unverified, the host its client id lives on, the host it returns
  to, a workspace picker (workspaces you own and where the owner allows AI
  apps), and the scopes, with sensitive ones unticked. Nothing is
  pre-approved. A new connection sends a security email.

## Writes

Each write scope covers one domain and is opt-in (unticked on the key form and
the consent screen):

| Scope               | Tools                                             | What                                                                              |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `water:write`       | `water.log`, `water.delete`                       | Plain water (needs the member's plain-water logging on)                           |
| `body:write`        | `body.log`, `body.delete`                         | Weight, body fat, muscle mass, bone mass, body water                              |
| `vitals:write`      | `vitals.log`, `vitals.delete`                     | Blood pressure (with pulse), heart rate, resting HR, SpO₂, respiration            |
| `supplements:write` | `supplements.logTaken`, `supplements.deleteTaken` | One of the member's own supplements taken, by name                                |
| `workouts:write`    | `workouts.log`, `workouts.delete`                 | A workout session: type, duration, effort, catalog exercises with their sets      |
| `sleep:write`       | `sleep.log`, `sleep.delete`                       | A night of sleep (bedtime, wake time, optional quality 1–5)                       |
| `trackers:write`    | `trackers.log`, `trackers.delete`                 | Entries in the member's own custom trackers whose AI switch is on                 |
| `pain:write`        | `pain.log`, `pain.delete`                         | Pain ratings, one entry per body region (needs the pain log and its AI switch on) |
| `food:write`        | `food.log`, `food.delete`                         | A meal draft the member reviews and logs in the meal diary (draft)                |
| `labs:write`        | `labs.log`, `labs.delete`                         | Lab results for the member's own markers, confirmed on the Labs screen (draft)    |

A grant without the scope gets `403 insufficient_scope`; on `/api/mcp` the
challenge names the scope so the app can ask for it (approving again updates
the connection's scopes without reconnecting). No scope is reserved any more.

- **Same paths as the app.** Entries go through the domain write paths the
  quick log and the app's own forms use (plain-water diary,
  `ingestMetricSample` with the manual-entry ranges and the blood pressure
  rule, supplement intakes, the workout repository, manual sleep nights, the
  tracker and pain services), as the member's own manual entries. Values out
  of range, an unknown supplement or tracker, or a time in the future fail
  the whole call before anything is written.
- **Workouts** take catalog exercise ids from `exercises.search` (the member's
  own custom exercises are listed there too); a session with only a type, a
  duration and an effort rating is fine. A session with an exercise given by
  name only (not in the catalog) is a draft: see below. An `exerciseId` the
  workspace cannot see is refused.
- **Sleep** is saved as a manual night (`entryMode: "manual"`, #440), with the
  app's own sleep form rules (10 minutes to 24 hours, not ending in the
  future). A night that overlaps a device night is `possibleDuplicate: true`,
  and the device night counts in the totals.
- **Trackers** take a `trackerId` from `trackers.list`: only the member's own
  trackers with "Coach and connected AI apps can read this" on, never a shared
  tracker someone else owns. The value follows the tracker's kind (a number,
  1–5, true or false, or minutes for a duration). An entry within ten minutes
  of one imported from Apple Health or Health Connect in the same tracker is a
  possible duplicate.
- **Pain** is refused unless the member turned the pain log on and "Coach and
  connected AI apps can read my pain log" is on (#442); the pain service checks
  both again inside the write.
- **Drafts the member confirms (M2c).** Meals, lab results and workouts with
  an exercise that is not in the catalog are not saved at once. Each becomes a
  row in `ai_app_draft` (its `ai_app_entry` points at it) and the log call
  returns it with `status: "pending_review"` instead of `"saved"`. Nothing
  reaches the member's records until they confirm it in the web or mobile
  app, where each draft says "via <app name>"; discarding it saves nothing.
  - **Food** (`food.log`): one entry per meal, either a `description` in the
    member's words, split by the same local parser as "Describe a meal" (#73),
    or `items` already split (food, quantity as stated, unit). There is no
    field for a nutrient value, weight or portion the member did not say;
    unclear amounts are flagged, never guessed. The draft is listed at the top
    of "Describe a meal" (`/food-draft`); "Review" opens it in the usual
    review, where the member matches each item to a food and logs it in the
    meal diary with its own confirmation, then marks the draft done or
    discards it.
  - **Labs** (`labs.log`): `marker` must be one of the member's lab markers
    (a `blood_marker_*` definition in the workspace, by code such as
    `ferritin` or by name) and `unit` one the marker already uses. Spelling is
    forgiven (case, spaces, `u`/`µ`), nothing else: no conversion is ever
    made. Otherwise the call fails with the list, in the message and, on REST,
    as `accepted_units` (or `known_markers` for an unknown marker). A
    `referenceRange` is saved only when the app sends one, kept as the range
    from the report (`refRangeSource: "report"`) and shown "(from the report)"
    on review. The result waits in "Waiting for your review" on the Labs
    screen; "Save to my labs" writes it with `ingestMetricSample`, tagged with
    the app like any other AI reading.
  - **Workouts:** the draft keeps the catalog exercises and the named ones. On
    Workouts, the member chooses a catalog exercise for each named one or adds
    it as their own exercise (`exerciseCatalog.createCustom`), then "Save
    workout" saves it through the workout repository.
  - The member's side is `aiApps.drafts.list`, `aiApps.drafts.confirm`
    (procedure access `write`) and `aiApps.drafts.discard` (`always`, like
    deleting what an app wrote). A confirmed lab result or workout keeps the
    app's tag: its `ai_app_entry` now points at the saved rows, so the app's
    own `labs.delete` / `workouts.delete` and "Delete everything this app
    wrote" still reach it. A confirmed or discarded meal draft leaves nothing
    behind; the foods the member logged are their own entries. Confirming
    twice saves once.
  - Retries never duplicate a draft: its id is derived from the entry key.
    `*.delete` with a draft's `entryId` deletes the draft. "Delete everything
    this app wrote" also deletes every draft still waiting, including one a
    failed call never recorded.
  - The mobile app reviews them too, with the same procedures: lab results in
    "Waiting for your review" on Labs, workouts on Training, and meal drafts
    on the food diary, where "Review" opens Add food's "From app" tab for the
    day, meal and time the app sent. Each item is matched and logged through
    the usual search, then the draft is marked done or discarded.
- **Idempotent.** Every call needs a `mutationId`. Its receipt (`ai_app_write`)
  works like the plain-water receipts (#83): a retry with the same id and
  arguments returns the first result (`replayed: true`) and writes nothing; the
  same id with other arguments is refused. Each entry also gets a key derived
  from the grant, the id and its position, used as the domain's own mutation id
  or dedupe hash, so a retry after a failure half-way through never duplicates
  an entry.
- **Source.** Every entry (and every draft) is recorded in `ai_app_entry`
  with the grant that wrote it and shown as "via <app name>". On the timeline,
  `timeline.list({ source: "ai_app:<grantId>" })` (or `/records/timeline?source=…`)
  shows only one app's entries: readings, sleep nights, tracker entries and
  pain entries. Water, supplement intakes and workouts are not timeline items
  yet; they carry the same tag in `ai_app_entry` and are counted and deleted
  with the rest. The quick log's "recent entries" are the member's own only,
  so nothing an app wrote is offered there to repeat.
- **Ownership.** `*.delete` deletes only entries the same grant wrote, by the
  `entryId`s its log calls returned; any other id is answered `not_found` and
  left alone. There is no edit tool: an app corrects an entry by deleting it and
  logging it again. Revoking a grant keeps what it wrote;
  `aiApps.deleteWrites` ("Delete everything this app wrote" on the web settings
  page) deletes all of it through each domain's own delete.
- **Device data wins.** An entry never overwrites or merges into device data.
  A reading within ten minutes of a device reading of the same metric is
  returned as `possibleDuplicate: true` (the typed-in blood pressure rule), and
  daily vitals totals leave it out so the device reading counts; the same goes
  for a night overlapping a device night.
- **Limits.** At most 100 entries per call and 1,000 added per grant a day
  (env, above); past the daily limit the call gets `429` with `Retry-After`.
  On Cloud, a read-only workspace refuses write tools (`403 access_read_only`
  on REST) while reads keep working.
- **Never stored:** arguments and results stay out of the usage record; a
  receipt keeps a SHA-256 fingerprint of the request and entry ids only.

## Endpoints

| Path                                                              | What                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /api/mcp`                                                   | MCP Streamable HTTP (2026-07-28, and 2025-era stateless)  |
| `GET /api/v1/tools`                                               | The tools this key may call, with JSON Schemas            |
| `POST /api/v1/tools/<name>`                                       | Call one tool; the JSON body is its input                 |
| `GET /.well-known/oauth-protected-resource/api/mcp`               | RFC 9728 protected resource metadata (also at the root)   |
| `GET /.well-known/oauth-authorization-server/api/auth`            | RFC 8414 authorization server metadata (also at the root) |
| `/api/auth/oauth2/authorize`, `…/token`, `…/register`, `…/revoke` | OAuth endpoints (issuer `https://<server>/api/auth`)      |

`/api/mcp` takes `Authorization: Bearer ov_…` or `Bearer ovat_…`; the REST API
takes personal keys only. An unauthenticated MCP request gets `401` with
`WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="records:read"`;
calling a tool the grant has no scope for gets `403` with
`error="insufficient_scope"` and the scopes to ask for. The authorization
server metadata advertises `S256` PKCE, the RFC 9207 `iss` response parameter,
`client_id_metadata_document_supported`, and the `none` and `private_key_jwt`
token endpoint methods; the token endpoint takes
`application/x-www-form-urlencoded` and answers a dead refresh token with
`invalid_grant`.

Tools: `healthSnapshot`, `labs`, `markerTrend`, `panelCompare`, `outOfRange`,
`bodyComp`, `weightTrend`, `supplements`, `goals`, `timelineSummary`,
`nutritionContext` (nutrition scope), `sleep.sessions`, `workouts.list`,
`vitals.daily`, `weights.daily`, `labs.history`, `body.privateMeasurements`
(private body scope), `trackers.*` (trackers scope), `pain.entries` (pain
scope), `exercises.search`, and the write tools above. Range reads cover at most 365 days
and page with `nextCursor`. Times are ISO 8601 with the member's UTC offset;
values keep their stored unit next to the member's preferred unit.

## Reachability

claude.ai and ChatGPT connect **from the vendor's cloud**, not from the
member's browser, so the server must be reachable from the public internet
over HTTPS: `BETTER_AUTH_URL` must be an `https://` URL on a public domain,
with the paths above routed to the server (`deploy/Caddyfile` does this,
including the `/.well-known/oauth-*` documents at the domain root). If you
filter inbound traffic, allow Anthropic's outbound ranges `160.79.104.0/21`
and `153.61.208.0/20` for claude.ai
([list](https://platform.claude.com/docs/en/api/ip-addresses)), and OpenAI's
[published egress ranges](https://developers.openai.com/api/docs/guides/ip-addresses)
for ChatGPT. When the server
URL is plain HTTP (other than `localhost`), OAuth stays off and only personal
keys work.

A self-hosted server on a LAN or VPN works with personal keys (or OAuth from
a local client that can reach it); web connectors need the public domain.

## Connecting

Claude Code with OAuth (it opens the browser for sign-in and consent):

```bash
claude mcp add --transport http openvalens https://<your-server>/api/mcp
```

Claude Code with a personal key:

```bash
claude mcp add --transport http openvalens https://<your-server>/api/mcp \
  --header "Authorization: Bearer ov_…"
```

claude.ai: Customize → Connectors → Add → Add custom connector, URL
`https://<your-server>/api/mcp`. ChatGPT: Plugins → Add custom MCP server (it
was called developer mode), the same URL with OAuth.

Member-facing, step-by-step pages per client (claude.ai, Claude Desktop,
Claude Code, Cursor, ChatGPT, a local model) are in
[help/ai-apps](help/ai-apps/README.md); Settings → Connected AI apps links to
them.

### Settings → Connected AI apps

The web page (`/settings/ai-apps`, linked from the security emails) lists the
member's **Connections** (OAuth) and **Personal keys** in the active
workspace, with scopes, consent version, dates, each grant's recent activity
and Revoke, how many entries each one added (with "Show on timeline" and
"Delete everything this app wrote"), and creates keys (shown once, with a
ready-to-paste Claude Code command). Settings also carries the owner's **Members can connect AI apps**
switch. The mobile app can view and revoke only. Both hide everything while
`aiApps.status` reports `enabled: false`.

### Trying OAuth locally

Run the server and web app with `MCP_ENABLED=true` and
`BETTER_AUTH_URL=http://localhost:3000` (loopback HTTP is allowed for
development), then `claude mcp add --transport http openvalens-dev
http://localhost:3000/api/mcp` and `/mcp` in Claude Code to authenticate. To
try claude.ai or ChatGPT against a development machine, put the server behind
an HTTPS tunnel and set `BETTER_AUTH_URL` and `CORS_ORIGIN` to the tunnel's
URL; never point a web connector at production while testing.
