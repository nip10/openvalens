# Single sign-on (OIDC)

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-15

Besides email-link sign-in, an instance can use **one generic OpenID Connect
provider** that you run or subscribe to: Authentik, Keycloak, Zitadel,
PocketID, Auth0, Google Workspace and others (Issue #65). It is off by default.
With it off, the sign-in page is unchanged.

## What it does and does not do

- **Sign-in only, invite-only.** OIDC never creates an account. Accounts still
  come only from the [first-administrator setup](install.md) and from
  invitations. An IdP identity with no connected account is refused with
  "ask your administrator for an invitation".
- **No implicit account linking.** If the IdP reports the same email address
  as an existing account, nothing is linked. A signed-in user connects their
  IdP identity explicitly under **Settings → Sign-in methods**. The connection
  is stored as the issuer plus the subject (`iss` + `sub`), never the email.
  The IdP email must still match the account email when connecting.
- **The first administrator is always a local account.** A misconfigured IdP
  cannot become the owner. Roles are never taken from IdP claims.
- **Email links keep working.** Disconnecting the IdP or losing access to it
  never locks anyone out.
- Verified tokens only: the provider is used only if its discovery document
  publishes an issuer and a JWKS. ID tokens are checked for signature, issuer,
  audience and nonce, and PKCE is required. Tokens the IdP returns are
  encrypted at rest.

## 1. Register a client at your IdP

Create a confidential OAuth 2.0 / OIDC client (authorization code flow) with:

- **Redirect URI:** `https://<domain>/api/auth/callback/<provider id>`, where
  `<provider id>` is the value you choose for `OIDC_PROVIDER_ID` below (for
  example `authentik`).
- **Scopes:** `openid`, `email`, `profile`.

Note the client id, the client secret and the issuer's discovery URL (it ends
in `/.well-known/openid-configuration`).

## 2. Configure the stack

Write the client secret to a file and add the other settings to
`deploy/.env`:

```bash
# bash: the secret is read from a hidden prompt, never from the command line
read -rs -p 'OIDC client secret: ' secret && echo &&
  printf '%s\n' "$secret" >deploy/secrets/server/OIDC_CLIENT_SECRET && unset secret
chmod 0444 deploy/secrets/server/OIDC_CLIENT_SECRET
cat >>deploy/.env <<'ENV'
OIDC_PROVIDER_ID=authentik
OIDC_CLIENT_ID=openvalens
OIDC_CLIENT_SECRET_FILE=/run/secrets/OIDC_CLIENT_SECRET
OIDC_DISCOVERY_URL=https://auth.example.org/application/o/openvalens/.well-known/openid-configuration
OIDC_DISPLAY_NAME=Example SSO
ENV
deploy/setup.sh upgrade
```

| Variable                  | Required | Purpose                                                                          |
| ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `OIDC_PROVIDER_ID`        | yes      | Lowercase id in the redirect URI. Changing it disconnects every user's IdP link. |
| `OIDC_CLIENT_ID`          | yes      | Client id from step 1.                                                           |
| `OIDC_CLIENT_SECRET_FILE` | yes      | Path of the mounted client-secret file.                                          |
| `OIDC_DISCOVERY_URL`      | yes      | The issuer's discovery document; must be `https`.                                |
| `OIDC_DISPLAY_NAME`       | no       | Button label, "Continue with …". Defaults to "Single sign-on".                   |

OIDC turns on only when all four required values are set. If some are missing
the server still starts, keeps OIDC off and logs `auth.oidc.config.incomplete`
with the names of the missing keys. The readiness probe reports
`checks.integrations.oidc.state` as `configured` or `off`
([Configuration](configuration.md#optional-providers)).

The discovery document is fetched when the server starts. If the IdP is
unreachable at that moment, the button is shown but sign-in fails until the
server is restarted.

## 3. Connect accounts

1. Invite people as usual. They join with the emailed token and code.
2. Each person signs in with their email link, opens **Settings → Sign-in
   methods** and chooses **Connect**.
3. From then on **Continue with <name>** on the sign-in page signs them in.

## Not supported

More than one OIDC provider, other named social buttons (GitHub), SAML,
SCIM and roles from IdP claims. Google and Apple have their own page:
[Google and Apple sign-in](google-apple-sign-in.md). The mobile app shows **Continue with <name>**
when OIDC is configured (#295), but signing in with OIDC on a phone is not yet
verified on devices.
