# Connecting the mobile app

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-24

The mobile app (`apps/native`, built with Expo) talks to one server, and that
server is chosen **when the app is built**, not in the app. There is no
in-app setting for a server address at 0.1.0, and there is no official store
build to point at your instance, so connecting a phone to your instance means
building the app yourself.

## How the app finds the server

The server address is the `EXPO_PUBLIC_SERVER_URL` variable of
`apps/native/.env.schema`. Expo compiles it into the app's JavaScript bundle,
and the app sends every request to it:

- `https://<domain>/rpc` for the API;
- `https://<domain>/api/auth/*` for sign-in.

On the supported install, Caddy routes both paths to the server
([Install](install.md#what-you-get)), so the value is your instance's public
origin: `https://<domain>`, with no path and no trailing slash.

## Build for your instance

From a clone of the same version as your server:

```bash
bun install
printf 'EXPO_PUBLIC_SERVER_URL=https://<domain>\n' > apps/native/.env.local
```

`apps/native/.env.local` is git-ignored. Check that the value resolves:

```bash
cd apps/native && bunx varlock load
```

The output lists `EXPO_PUBLIC_SERVER_URL` with your URL. Then build or run the
app with the usual Expo tooling, for example `bun run dev:native` from the
repository root for a development build, or `bun run ios` / `bun run android`
inside `apps/native` for a native build. Building and signing for a physical
device or a store needs your own Apple or Google developer setup, which these
docs do not cover.

Changing the server later means rebuilding the app: an app built for one server
connects only to that server.

## Push notifications

Insight and care-reminder pushes go from your server through the
[Expo push service](https://docs.expo.dev/push-notifications/overview/) to
Apple (APNs) and Google (FCM). Two sides have to be set up:

- **Server:** set `PUSH_PROVIDER=expo` ([Configuration](configuration.md)).
  The server needs no credential for this.
- **App build:** the app can only get a push token when it is built with an
  [EAS](https://docs.expo.dev/eas/) project ID, and that EAS project must hold
  your APNs and FCM credentials. Without a project ID the app still works and
  shows push notifications as unavailable.

The project ID is required because `getExpoPushTokenAsync` attributes the token
to a project; Expo
[recommends passing it explicitly](https://docs.expo.dev/versions/latest/sdk/notifications/#getexpopushtokenasyncoptions),
read from `Constants.expoConfig.extra.eas.projectId`
([setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/#configure-projectid)),
which is what the app does.

### 1. Create the EAS project

With an [Expo account](https://expo.dev/signup), create a project (on
expo.dev or with `bunx eas-cli init` inside `apps/native`) and copy its
project ID, a UUID.

### 2. Set the project ID at build time

`apps/native/app.config.ts` extends `app.json` and copies
`EXPO_PUBLIC_EAS_PROJECT_ID` into `extra.eas.projectId`. For a local build,
add it next to the server URL:

```bash
printf 'EXPO_PUBLIC_EAS_PROJECT_ID=<project-id>\n' >> apps/native/.env.local
cd apps/native && bunx expo config --type public | grep projectId
```

For [EAS Build](https://docs.expo.dev/build/introduction/), `.env.local` is
git-ignored and therefore not uploaded, so define the variable as an
[EAS environment variable](https://docs.expo.dev/eas/environment-variables/)
or in the build profile's `env` in `eas.json`, and export it in the shell that
runs `eas` so the CLI sees the same project.

### 3. Add Apple and Google credentials to the EAS project

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

## Signing in

- Accounts are created on the web: the first administrator through `/setup`
  and everyone else through an invitation at `/join`
  ([Install](install.md#first-administrator-and-invitations)). The app cannot
  create an account.
- An existing account signs in on the phone with an emailed magic link, which
  returns to the app through its URL scheme `openvalens://`. Email must
  therefore work ([Email](email.md)).

## Distributing your build

If you hand your build to other people, the licence and trademark rules apply:
a build that is not made from an official release tag, or that you modified,
must use a different name and app identifier, and the exact source must be
available ([Licensing and trademark](licensing.md)).

## Not verified

The build-time configuration above was checked with `varlock load`, and the
push project ID with `expo config`. Signing in, and registering for and
receiving pushes, on a physical device against a self-hosted instance have not
been verified for 0.1.0.
