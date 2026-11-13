# Connect a local model or app

Any app that can talk to a remote MCP server over HTTP and send a header can
use OpenValens with a personal key. This works with a server on your home
network or VPN, as long as your computer can reach it. The example below is
LM Studio, checked against its [MCP documentation](https://lmstudio.ai/docs/app/mcp)
(LM Studio 0.3.17 or later) in November 2026. For other apps, see the app's
own documentation for adding a remote MCP server with a header.

## What you need

- Your server address, ending in `/api/mcp`.
- A personal key: Settings → Connected AI apps → Personal keys → **Create
  key**. Copy it when it is shown; you will not see it again.

## LM Studio

1. In LM Studio, switch to the **Program** tab in the right-hand sidebar.
2. Click **Install**, then **Edit mcp.json**.
3. Add OpenValens:

   ```json
   {
     "mcpServers": {
       "openvalens": {
         "url": "https://<your-server>/api/mcp",
         "headers": { "Authorization": "Bearer ov_…" }
       }
     }
   }
   ```

4. Save the file, then ask the model about your records.

A small local model may need a clear question to pick the right tool, for
example "Use OpenValens to show my weight trend for the last 90 days."

## Scripts

The same tools are available over plain HTTP for scripts:

```bash
curl -s https://<your-server>/api/v1/tools \
  -H "Authorization: Bearer ov_…"

curl -s -X POST https://<your-server>/api/v1/tools/weightTrend \
  -H "Authorization: Bearer ov_…" -H "content-type: application/json" -d '{}'
```

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke** next to the key.
- In the app: delete the `openvalens` entry from its `mcp.json`.
