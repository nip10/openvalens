# Connecting the mobile app

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-28

The OpenValens app from the App Store and Google Play connects to any
OpenValens server, not only to OpenValens Cloud. You do not need to build the
app yourself. Building your own is still possible and is described at the end
of this page.

## Connect the store app to your server

On first launch, before signing in, the app asks where the account is:

- **OpenValens Cloud**, the hosted service (`https://app.openvalens.com`);
- **My own server**: enter your instance's public origin, for example
  `https://health.example.org`.

The app reduces what you type to an origin (it adds `https://` when no scheme
is given, and drops any path, query or trailing slash), then checks the server
before saving it. To use another server later, open **Settings → Server →
Change server**. Changing server signs you out and removes everything the app
saved from the old server on that phone: the session, cached screens, queued
writes and health-sync progress. If writes are still waiting to be sent, the
app says how many before it deletes them.

## What your server must offer

- **HTTPS with a valid certificate.** The store app refuses plain HTTP. The
  supported install gets a certificate from Caddy automatically
  ([Install](install.md#what-you-get)).
- **The server paths on your public origin.** The app sends every request to
  that origin:
  - `/.well-known/openvalens` for the server check;
  - `/rpc` for the API;
  - `/api/auth/*` for sign-in.

  On the supported install Caddy routes all three to the server. Behind your
  own proxy, or on a platform where web and API share a domain, route
  `/.well-known/openvalens` to the server as well, next to `/rpc` and `/api`.
  When the API has its own domain ([Deployment](../deployment.md)), enter that
  domain in the app.

- **A version the app supports.** The server check returns the API version the
  server speaks. An app that is older or newer than your server says so, and
  names your server's version.
- **Working email**, for magic-link sign-in ([Email](email.md)).

The store app's URL scheme, `openvalens://`, is already a trusted origin on
every server, so sign-in returns to the app without extra configuration.

### Check it

```bash
curl -fsS https://<domain>/.well-known/openvalens
```

The answer looks like this:

```json
{
  "product": "openvalens",
  "apiVersion": 1,
  "serverVersion": "0.1.0",
  "mode": "self-hosted",
  "signIn": { "magicLink": true, "oidc": false, "google": false, "apple": false, "signUp": false }
}
```

It is public and needs no session. It holds nothing beyond what your login
page already shows: no instance name, no OIDC provider name and no counts.
`signIn` tells the app which sign-in options to show; `oidc` is `true` when
[OIDC sign-in](oidc.md) is configured.

When the check fails, the app tells the person which of these it is: the
server cannot be reached, the address is not an OpenValens server (often a
proxy that sends `/.well-known/openvalens` to the web app), the address is not
HTTPS, or the server or the app needs an update.

## Signing in

- Accounts on a self-hosted server are created on the web: the first
  administrator through `/setup` and everyone else through an invitation at
  `/join` ([Install](install.md#first-administrator-and-invitations)). The
  app cannot create an account on a self-hosted server.
- An existing account signs in on the phone with an emailed magic link, which
  returns to the app through `openvalens://`. With OIDC configured, the app
  also shows "Continue with <name>".

## Push notifications

Insight and care-reminder pushes go from your server through the
[Expo push service](https://docs.expo.dev/push-notifications/overview/) to
Apple (APNs) and Google (FCM). On the server, set `PUSH_PROVIDER=expo`
([Configuration](configuration.md)); the server needs no credential for this.
The store app carries the OpenValens project's push setup, so nothing else is
needed for it. A build of your own needs its own push setup, described below.

## Build the app yourself (optional)

You only need this to change the app, or to ship a build locked to your
server.

### Lock a build to your server

From a clone of the same version as your server:

```bash
bun install
printf 'EXPO_PUBLIC_SERVER_URL=https://<domain>\n' > apps/native/.env.local
```

`apps/native/.env.local` is git-ignored. With `EXPO_PUBLIC_SERVER_URL` set,
the app skips the server choice, connects only to that origin and hides
"Change server". Leave it unset to build the same app as the store, which
asks. Check that the value resolves:

```bash
cd apps/native && bunx varlock load
```

Then build or run the app with the usual Expo tooling, for example
`bun run dev:native` from the repository root for a development build, or
`bun run ios` / `bun run android` inside `apps/native` for a native build. A
development build also accepts plain HTTP to localhost or the local network.
Building and signing for a physical device or a store needs your own Apple or
Google developer setup, which these docs do not cover.

### Push for your own build

The app can only get a push token when it is built with an
[EAS](https://docs.expo.dev/eas/) project ID, and that EAS project must hold
your APNs and FCM credentials. Without a project ID the app still works and
shows push notifications as unavailable.

The project ID is required because `getExpoPushTokenAsync` attributes the token
to a project; Expo
[recommends passing it explicitly](https://docs.expo.dev/versions/latest/sdk/notifications/#getexpopushtokenasyncoptions),
read from `Constants.expoConfig.extra.eas.projectId`
([setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/#configure-projectid)),
which is what the app does.

#### 1. Create the EAS project

With an [Expo account](https://expo.dev/signup), create a project (on
expo.dev or with `bunx eas-cli init` inside `apps/native`) and copy its
project ID, a UUID.

#### 2. Set the project ID at build time

`apps/native/app.config.ts` extends `app.json` and copies
`EXPO_PUBLIC_EAS_PROJECT_ID` into `extra.eas.projectId`. For a local build,
add it to `apps/native/.env.local`:

```bash
printf 'EXPO_PUBLIC_EAS_PROJECT_ID=<project-id>\n' >> apps/native/.env.local
cd apps/native && bunx expo config --type public | grep projectId
```

For [EAS Build](https://docs.expo.dev/build/introduction/), `.env.local` is
git-ignored and therefore not uploaded, so define the variable as an
[EAS environment variable](https://docs.expo.dev/eas/environment-variables/)
or in the build profile's `env` in `eas.json`, and export it in the shell that
runs `eas` so the CLI sees the same project.

#### 3. Add Apple and Google credentials to the EAS project

- **iOS (APNs):** a paid Apple Developer account is required. When
  `eas build` asks, let it set up push notifications and generate an APNs key,
  or run `eas credentials` if you do not build with EAS
  ([iOS setup](https://docs.expo.dev/push-notifications/push-notifications-setup/#get-credentials-for-development-builds)).
- **Android (FCM v1):** create a Firebase project with an Android app for
  your package name. Upload a Google service account key for FCM v1 to the EAS
  project (`eas credentials` → Android → Google Service Account, or the
  project's Credentials page on expo.dev), and keep that key out of git. Then
  download the app's `google-services.json` and set `GOOGLE_SERVICES_JSON` to
  its path at build time; `app.config.ts` sets `android.googleServicesFile`
  from it ([FCM v1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)).

Push needs a development or release build, not Expo Go, on a device that
supports push (a physical phone, an Android emulator with Google Play services,
or an iOS simulator on Xcode 14 or later). A tapped notification opens the
matching screen (insights or preventive care); the app ignores any other path
in a push.

### Distributing your build

If you hand your build to other people, the licence and trademark rules apply:
a build that is not made from an official release tag, or that you modified,
must use a different name and app identifier, and the exact source must be
available ([Licensing and trademark](licensing.md)).

## Not verified

The server check was tested against the server's route and the app's parsing
in unit tests. Connecting the published store app to a self-hosted instance,
OIDC sign-in on the phone, and push from a self-hosted server to the store app
have not been verified on a device for 0.1.0; the store apps are not published
yet (#306).
