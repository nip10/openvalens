# Connect an AI app to your OpenValens records

You can let an AI app, such as Claude, ChatGPT, Cursor or a model running on
your own computer, read your OpenValens records so it can answer questions
about your sleep, training, labs and other measures. The app reads only
**your own records in one workspace**, and only what you allow. It cannot
change anything.

Open **Settings → Connected AI apps** in the OpenValens web app to see what is
connected, make a personal key, read each app's recent activity and revoke
access.

## Pick your app

| App                                    | How it signs in                        | Needs a public HTTPS server |
| -------------------------------------- | -------------------------------------- | --------------------------- |
| [claude.ai](claude-ai.md)              | Sign in with OpenValens                | Yes                         |
| [Claude Desktop](claude-desktop.md)    | Sign in with OpenValens (as claude.ai) | Yes                         |
| [Claude Code](claude-code.md)          | Sign in with OpenValens, or a key      | No, with a key              |
| [Cursor](cursor.md)                    | A personal key, or sign in             | No, with a key              |
| [ChatGPT](chatgpt.md)                  | Sign in with OpenValens                | Yes                         |
| [A local model or app](local-model.md) | A personal key                         | No                          |

## Before you start

- **Your server address.** It ends in `/api/mcp`, for example
  `https://openvalens.example.com/api/mcp`. Settings → Connected AI apps shows
  yours under "How to connect an app".
- **Is it turned on?** On OpenValens Cloud it is. On a self-hosted server the
  operator has to set `MCP_ENABLED=true`; until then the settings page is
  hidden. See [Connected AI apps for operators](../../ai-apps.md).
- **Only the workspace owner can connect apps for now**, because a workspace
  holds one person's records. The owner can also turn **Members can connect AI
  apps** off in Settings, which pauses every key and connection in that
  workspace.
- **Web apps need a public server.** claude.ai, Claude Desktop's connectors
  and ChatGPT connect from the vendor's own servers, not from your computer.
  Your OpenValens server must be reachable from the internet over HTTPS. A
  server on a home network or VPN works with a personal key from an app on
  your own computer (Claude Code, Cursor, a local model).

## What the app can read

You choose when you connect:

- **Your records** (always): labs, sleep, workouts, vitals, weight and body
  composition, supplements and goals.
- **Nutrition**, **private body measurements** and **notes**: each off unless
  you tick it.

Cycle data and progress photos are never shared with any app. Whatever the app
reads goes to that app under its own terms and privacy policy; OpenValens
cannot control what it does with it. This consent (`mcp-v1`) is separate from
Coach AI consent.

## Personal keys

A key works like a password for one app. Make one in **Settings → Connected AI
apps → Personal keys → Create key**: give it a name, choose what it may read
and when it expires (30, 90 or 365 days, or never), and agree to the consent.
The key starts with `ov_` and is shown **once**; copy it then. You can have up
to ten active keys. Creating one sends you a security email.

## Revoke access

In **Settings → Connected AI apps**, select **Revoke** next to the connection
or key. The app stops reading your records on its next request. What it
already read stays with the app. You can also remove the server from the app
itself (each page below says how), but revoking in OpenValens is what cuts
access.

If you get an email about a key or connection you did not make, revoke it from
the link in that email and change your sign-in details.
