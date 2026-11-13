# Connected AI apps (MCP server and REST tool API)

Members can point an AI app (claude.ai, ChatGPT, Claude Code, Claude Desktop,
Cursor, a script or a local model) at their **own** records, read-only
(Issue #439). Web connectors such as claude.ai and ChatGPT sign in with
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
with `429` and `Retry-After`. See [configuration](self-hosting/configuration.md).

The workspace owner can turn **Members can connect AI apps** off (on by
default). Existing keys and connections in that workspace stop on their next
call. The switch is separate from the Coach AI switch, and the AI-app consent
(`mcp-v1`) is separate from Coach consent.

## Grants

Every key and every OAuth connection is a **grant** (`ai_app_grant`): one
member's own records in one workspace they own, with `records:read` plus any of
`nutrition:read`, `private_body:read`, `notes:read` and `trackers:read` (all off
by default; a custom tracker with its own AI switch off stays invisible),
and the `mcp-v1` consent. Revoking a grant, expiry, leaving the workspace,
losing ownership or the owner's switch stops the next call. Cycle data and
progress photos are never reachable (lint rule, allowlisted sources in
`packages/mcp/src/sources.ts`, and an integration test). Write scopes are
reserved and refused for now.

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
(private body scope) and `exercises.search`. Range reads cover at most 365 days
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
and Revoke, and creates keys (shown once, with a ready-to-paste Claude Code
command). Settings also carries the owner's **Members can connect AI apps**
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
