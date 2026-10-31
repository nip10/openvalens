# Sign in with Google and Apple

**Applies to:** OpenValens 0.9.0 · Last updated: 2026-10-29

Besides email-link sign-in (and an optional [OIDC provider](oidc.md)), an
instance can offer **Continue with Google** and **Continue with Apple**
(Issue #296). Each is off until all of its settings are set. With both off,
the sign-in page and the app are unchanged.

## What it does and does not do

- **Self-hosted: sign-in only, invite-only.** A Google or Apple login never
  creates an account on a self-hosted server. Accounts still come from the
  [first-administrator setup](install.md) and from invitations. An identity
  with no connected account is refused with "No account is connected to that
  sign-in".
- **OpenValens Cloud (`DEPLOYMENT_MODE=cloud`): sign-up too.** On `/signup` the
  person ticks the terms of service and privacy policy, then chooses Google or
  Apple. The account is created by the same admission path as the emailed
  sign-up: role `user`, their own workspace as owner, the accepted terms and
  privacy versions with a timestamp, an audit event, and the trial (#297).
  Better Auth never creates the account itself. On `/login`, an identity with
  no account is refused and pointed at `/signup`.
- **No implicit account linking.** If Google or Apple reports the email of an
  existing account, nothing is linked, in either mode. A signed-in person
  connects Google or Apple under **Settings → Sign-in methods** (web) or
  **Settings → Account** (app). The connection is stored by the provider's
  stable subject (`sub`), never by the email. When connecting, the provider
  email must equal the account email; the one exception is an Apple "Hide My
  Email" address (`…@privaterelay.appleid.com`).
- **At least one way in.** A connection can be removed while an email link can
  reach the person. If the server cannot send email (dry run), the last
  connected sign-in method cannot be removed.
- **Tokens are encrypted at rest.** Google sign-in asks for `openid email
profile` only, with no offline access.
- **Apple specifics.** Apple's "client secret" is a short-lived JWT; the
  server signs it at runtime from your `.p8` key (30 days, renewed after 15,
  well inside Apple's 6-month limit). Apple sends the person's name only the
  first time they sign in to your app; it is saved then if the account has no
  name. Deleting an account (**Settings → Delete everything**) revokes the
  account's Apple tokens through Apple's REST API, as App Store Review
  Guideline 5.1.1(v) requires.

## Google

### 1. Create an OAuth client

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
create an **OAuth client ID** of type **Web application** with:

- **Authorized JavaScript origin:** `https://<domain>`
- **Authorized redirect URI:** `https://<domain>/api/auth/callback/google`

Configure the OAuth consent screen with the `openid`, `email` and `profile`
scopes. Note the client id (it ends in `.apps.googleusercontent.com`) and the
client secret.

### 2. Configure the stack

```bash
read -rs -p 'Google client secret: ' secret && echo &&
  printf '%s\n' "$secret" >deploy/secrets/server/GOOGLE_CLIENT_SECRET && unset secret
chmod 0444 deploy/secrets/server/GOOGLE_CLIENT_SECRET
cat >>deploy/.env <<'ENV'
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
ENV
deploy/setup.sh upgrade
```

`deploy/setup.sh` sets `GOOGLE_CLIENT_SECRET_FILE` because the secret file
exists.

### On the phone

The app signs in with Google in the system browser (the same redirect flow as
the web) and returns to the app on `openvalens://`. There is no native Google
SDK and nothing to register per app: one store app connects to any server,
and a native Google client id would tie it to one Google Cloud project.

## Apple

### 1. Register with Apple

In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list):

1. **App ID.** Enable **Sign in with Apple** on the app's App ID (for the
   store app, `com.openvalens.app`; for your own build, your bundle ID).
2. **Services ID** (for the web), for example `com.example.openvalens.signin`.
   Enable Sign in with Apple, choose the App ID above as its primary App ID,
   and add:
   - **Domain:** `<domain>`
   - **Return URL:** `https://<domain>/api/auth/callback/apple`

   Grouping the Services ID with the App ID gives a person the same Apple
   identity on the web and in the app.

3. **Key.** Create a key with **Sign in with Apple** enabled, configured for
   the primary App ID. Download the `.p8` file (Apple lets you download it
   once) and note its **Key ID** and your **Team ID**.
4. **Private email relay.** For "Hide My Email" addresses to receive sign-in
   links, register your sending domain or address (the `EMAIL_FROM` domain)
   under **Sign in with Apple for Email Communication**, and set up SPF and
   DKIM for it ([Email](email.md)). Until then, email to
   `…@privaterelay.appleid.com` is dropped by Apple.

### 2. Configure the stack

```bash
cp ~/Downloads/AuthKey_ABC123DEFG.p8 deploy/secrets/server/APPLE_PRIVATE_KEY
chmod 0444 deploy/secrets/server/APPLE_PRIVATE_KEY
cat >>deploy/.env <<'ENV'
APPLE_CLIENT_ID=com.example.openvalens.signin
APPLE_TEAM_ID=ABCDE12345
APPLE_KEY_ID=ABC123DEFG
APPLE_APP_BUNDLE_ID=com.openvalens.app
ENV
deploy/setup.sh upgrade
```

| Variable                 | Required | Purpose                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `APPLE_CLIENT_ID`        | yes      | The Services ID, used by the web flow.                             |
| `APPLE_TEAM_ID`          | yes      | Your Apple Developer Team ID.                                      |
| `APPLE_KEY_ID`           | yes      | The key's id.                                                      |
| `APPLE_PRIVATE_KEY_FILE` | yes      | Path of the mounted `.p8` key (set by `deploy/setup.sh`).          |
| `APPLE_APP_BUNDLE_ID`    | no       | Lets the iOS app use the native Apple sheet. Without it, web only. |

### On the phone

On iOS the app shows Apple's native sheet. The app first asks the server for a
single-use nonce, Apple signs an id token carrying it, and the server checks
the token against Apple's keys, the bundle ID and that nonce before it signs
the person in. The app then hands the server the sheet's authorization code,
which the server exchanges for a refresh token so the sign-in can be revoked
when the account is deleted. On Android (and on iOS when
`APPLE_APP_BUNDLE_ID` is not set), Continue with Apple opens Apple's web
sign-in in the browser instead, using the Services ID.

The app signs in only: in Cloud a new account is created on the web sign-up
page, which **Create an account** opens. **Settings → Account → Sign-in
methods** in the app connects and disconnects Google and Apple.

## Checking it

With all keys of a provider set, the server starts with it on and
`GET /.well-known/openvalens` reports `signIn.google` or `signIn.apple` as
`true`. If some keys are missing, the server still starts, keeps that provider
off and logs `auth.social.config.incomplete` with the names of the missing
keys. A malformed value (for example a key file that is not a P-256 `.p8`)
stops the server with `SOCIAL_SIGN_IN_CONFIG_INVALID`, naming the variable.

## Not supported

Native Google Sign-In on the phone, creating a Cloud account from inside the
app, linking more than one Google or Apple identity to one account, and taking
roles or profile changes from the provider after the first sign-in. The
provider sheets themselves are checked by hand, not by the automated tests.
