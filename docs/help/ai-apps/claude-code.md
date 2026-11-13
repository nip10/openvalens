# Connect Claude Code

Claude Code can sign in with your OpenValens account, or use a personal key.
Commands checked against Anthropic's
[Claude Code MCP guide](https://code.claude.com/docs/en/mcp) in November 2026.

## What you need

- Your server address, ending in `/api/mcp` (Settings → Connected AI apps
  shows it).
- Claude Code runs on your computer, so your OpenValens server only has to be
  reachable from that computer. A server on a home network or VPN works.
- You own the OpenValens workspace you want to connect.

## Sign in with OpenValens

1. Add the server:

   ```bash
   claude mcp add --transport http openvalens https://<your-server>/api/mcp
   ```

2. In Claude Code, run `/mcp`, choose `openvalens` and follow the steps in
   your browser. (From a terminal, `claude mcp login openvalens` does the same.)
3. On the OpenValens consent screen choose the workspace, tick any extra
   records you want to share, tick the consent and select **Allow access**.

Signing in needs the server address to be HTTPS (or `localhost`). If the
settings page says signing in from an app is not available, use a key.

## Use a personal key

1. In OpenValens, open Settings → Connected AI apps → Personal keys →
   **Create key**. Name it, choose what it may read and when it expires, and
   agree to the consent.
2. The page shows the key once, with a ready-to-paste command. Copy it, or
   type:

   ```bash
   claude mcp add --transport http openvalens https://<your-server>/api/mcp \
     --header "Authorization: Bearer ov_…"
   ```

By default Claude Code keeps the server for the current project only
(`--scope local`). Add `--scope user` to use it in every project. Avoid
`--scope project` with a key: that writes it to `.mcp.json`, a file meant to
be shared.

## Check it

`claude mcp list` shows the server and whether it connects. Then ask Claude,
for example, "How did I sleep last week?".

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke** next to the
  connection or key.
- In Claude Code: `claude mcp logout openvalens` clears a sign-in, and
  `claude mcp remove openvalens` removes the server.
