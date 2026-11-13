# Connect Claude Desktop

Claude Desktop uses the same **custom connectors** as claude.ai: they belong
to your Claude account and Anthropic's servers make the connection, not your
computer (see Anthropic's
[help article](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)).

## What you need

The same as [claude.ai](claude-ai.md): a plan with custom connectors, your
server address ending in `/api/mcp`, and a **public HTTPS** OpenValens server
reachable from Anthropic's outbound ranges (`160.79.104.0/21` and
`153.61.208.0/20`).

## Steps

Add OpenValens as a custom connector by following the
[claude.ai steps](claude-ai.md#steps), in claude.ai or in Claude Desktop. Once
connected, it is available in Claude Desktop under the same account.

### A server that is not on the public internet

Claude Desktop's local configuration file (`claude_desktop_config.json`) is
for local programs it starts on your computer. Anthropic does not document
pointing it at a remote server address, so we don't describe a setup for it
here. For a server on your home network or VPN, use
[Claude Code](claude-code.md) or [Cursor](cursor.md) with a personal key.

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke** next to the
  connection.
- In Claude: remove the connector as described on the
  [claude.ai page](claude-ai.md#revoke).
