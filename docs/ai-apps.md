# Connected AI apps (MCP server and REST tool API)

Members can point an AI app (Claude Code, Claude Desktop, Cursor, a script or a
local model) at their **own** records, read-only, with a personal API key
(Issue #439). OAuth sign-in for web connectors (claude.ai, ChatGPT) comes in a
later release; until then, use a personal key from a local client.

## Turning it on

| Deployment  | Default | Switch              |
| ----------- | ------- | ------------------- |
| Self-hosted | off     | `MCP_ENABLED=true`  |
| Cloud       | on      | `MCP_ENABLED=false` |

With it off, `/api/mcp` and `/api/v1/tools/*` do not exist (404) and readiness
reports `mcp: off`. Rate limits: `MCP_RATE_LIMIT_PER_GRANT_PER_MINUTE` (60) and
`MCP_RATE_LIMIT_PER_MEMBER_PER_MINUTE` (120), per server process, answered with
`429` and `Retry-After`. See [configuration](self-hosting/configuration.md).

The workspace owner can turn **Members can connect AI apps** off (on by
default). Existing keys in that workspace stop on their next call. The switch
is separate from the Coach AI switch, and the AI-app consent (`mcp-v1`) is
separate from Coach consent.

## Keys and grants

- A key covers one member's own records in one workspace they own, with
  `records:read` plus any of `nutrition:read`, `private_body:read` and
  `notes:read` (all off by default).
- Keys start with `ov_`, are shown once and stored only as a SHA-256 digest.
  They expire after 30, 90 (default) or 365 days, or never. A member can hold
  at most ten active keys. Creating one sends a security email.
- Revoking a key, expiry, leaving the workspace or losing ownership stops the
  next call. Cycle data and progress photos are never reachable (lint rule,
  allowlisted sources in `packages/mcp/src/sources.ts`, and an integration test).
- Each call keeps a light usage record (key, tool, time, status, row count;
  never arguments or results) for 90 days.

## Endpoints

| Path                        | What                                                     |
| --------------------------- | -------------------------------------------------------- |
| `POST /api/mcp`             | MCP Streamable HTTP (2026-07-28, and 2025-era stateless) |
| `GET /api/v1/tools`         | The tools this key may call, with JSON Schemas           |
| `POST /api/v1/tools/<name>` | Call one tool; the JSON body is its input                |

Both take `Authorization: Bearer ov_…`. Tools: `healthSnapshot`, `labs`,
`markerTrend`, `panelCompare`, `outOfRange`, `bodyComp`, `weightTrend`,
`supplements`, `goals`, `timelineSummary`, `nutritionContext` (nutrition
scope), `sleep.sessions`, `workouts.list`, `vitals.daily`, `weights.daily`,
`labs.history`, `body.privateMeasurements` (private body scope) and
`exercises.search`. Range reads cover at most 365 days and page with
`nextCursor`. Times are ISO 8601 with the member's UTC offset; values keep
their stored unit next to the member's preferred unit.

## Connecting Claude Code

```bash
claude mcp add --transport http openvalens https://<your-server>/api/mcp \
  --header "Authorization: Bearer ov_…"
```

A self-hosted server on a LAN or VPN works the same from a client on that
network; web connectors need a public HTTPS domain.
