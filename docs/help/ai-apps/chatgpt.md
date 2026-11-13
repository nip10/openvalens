# Connect ChatGPT

ChatGPT adds OpenValens as a **custom MCP server** and signs in with your
OpenValens account. OpenAI used to call this "developer mode"; custom servers
are now added from ChatGPT's Plugins page. Steps checked against OpenAI's
[Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)
guide in November 2026; if a label has moved, follow that page.

## What you need

- A ChatGPT plan and workspace that allow custom MCP servers. This depends on
  the plan and on your workspace admin's settings; see OpenAI's help center.
- ChatGPT on the web.
- Your server address, ending in `/api/mcp`.
- A **public HTTPS** OpenValens server. ChatGPT connects from OpenAI's
  servers. If your server filters incoming traffic, allow OpenAI's
  [published egress ranges](https://developers.openai.com/api/docs/guides/ip-addresses).
- ChatGPT cannot use personal keys; it always signs in.

## Steps

1. Go to [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Select the plus button, then **Add custom MCP server**.
3. Enter a name (for example `OpenValens`). Under **Connection**, enter your
   server address as the **Server URL**.
4. For authentication, choose **OAuth**.
5. Review the risk warning and select **I understand and want to continue**.
6. Select **Create as a plugin**, then install it.
7. When ChatGPT sends you to OpenValens, sign in if asked, then on the consent
   screen choose the workspace, tick any extra records you want to share, tick
   the consent and select **Allow access**.

In a chat, type `@` and pick the plugin to use it.

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke** next to the
  connection. This stops access on the next request.
- In ChatGPT: disconnect or remove the plugin from its settings; see OpenAI's
  help center for the current steps.
