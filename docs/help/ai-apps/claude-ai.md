# Connect claude.ai

claude.ai adds OpenValens as a **custom connector** and signs in with your
OpenValens account. Steps checked against Anthropic's
[custom connector guide](https://claude.com/docs/connectors/custom/add-unlisted)
and [help article](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
in November 2026; if a label has moved, follow those pages.

## What you need

- A Claude plan that allows custom connectors. Anthropic lists Free (one
  custom connector), Pro, Max, Ultra, Team and Enterprise. On Team and Enterprise
  only an organization owner can add one; see the guide above.
- Your OpenValens server address, ending in `/api/mcp` (Settings → Connected
  AI apps shows it).
- A **public HTTPS** OpenValens server. Claude connects from Anthropic's
  cloud, not from your browser, so a server on a home network or VPN will not
  work. If your server filters incoming traffic, allow Anthropic's outbound
  ranges, currently `160.79.104.0/21` and `153.61.208.0/20` (see
  [Anthropic's IP addresses](https://platform.claude.com/docs/en/api/ip-addresses)).
- You own the OpenValens workspace you want to connect, and its owner has not
  turned AI apps off.

## Steps

1. In claude.ai, go to **Customize > Connectors**.
2. Select **Add**, then **Add custom connector**.
3. Enter a name (for example `OpenValens`) and your server address, then
   click **Continue**.
4. For authentication, keep the options Claude marks **Detected**. OpenValens
   supports Claude's published identity and automatic registration.
5. Click **Add**, then **Connect**.
6. Your browser opens OpenValens. Sign in if asked, then on the consent screen
   check the app's name and address, choose the workspace, tick any extra
   records you want to share (nutrition, private body measurements, notes),
   tick the consent and select **Allow access**.

You get a security email from OpenValens. The connection now shows under
**Connections** in Settings → Connected AI apps.

Team and Enterprise owners add the connector under **Organization settings >
Connectors** instead; each member then connects it from **Customize >
Connectors** and approves it with their own OpenValens account.

### Using a personal key instead

Anthropic offers **Request headers** on custom connectors as a beta for some
organizations. If you see it, you can choose **No sign-in** and add a header
named `authorization` with the value `Bearer ov_…` (your key, with the word
`Bearer` and a space in front). If you don't see **Request headers**, sign in
as above.

## Revoke

- In OpenValens: Settings → Connected AI apps → **Revoke** next to the
  connection. This stops access on the next request.
- In claude.ai: **Customize > Connectors**, then **Remove** (or the three-dot
  menu) on the connector.

Removing the connector in claude.ai alone does not revoke it in OpenValens;
revoke it in OpenValens too.
