# Connect Cursor

Cursor reads MCP servers from an `mcp.json` file. Checked against Cursor's
[MCP documentation](https://cursor.com/docs/mcp) in November 2026.

## What you need

- Your server address, ending in `/api/mcp`.
- A personal key (Settings → Connected AI apps → Personal keys → **Create
  key**), or a server whose address is HTTPS if you want to sign in instead.
- Cursor runs on your computer, so with a key the server only has to be
  reachable from that computer.

## Steps

1. Open `~/.cursor/mcp.json` (for every project) or `.cursor/mcp.json` in a
   project. Prefer the global file for a key: the project file is meant to be
   shared.
2. Add OpenValens. Cursor can read the key from an environment variable, so
   it is not stored in the file:

   ```json
   {
     "mcpServers": {
       "openvalens": {
         "url": "https://<your-server>/api/mcp",
         "headers": { "Authorization": "Bearer ${env:OPENVALENS_KEY}" }
       }
     }
   }
   ```

   Set `OPENVALENS_KEY` to your `ov_…` key in the environment Cursor starts
   from.

3. Save the file and restart Cursor. The server shows under **Customize >
   MCPs**.

To sign in with your OpenValens account instead, leave out `headers`; Cursor
supports sign-in for remote servers and opens your browser. Approve it on the
OpenValens consent screen.

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke**.
- In Cursor: turn the server off or remove it under **Customize > MCPs**, or
  delete its entry from `mcp.json`.
