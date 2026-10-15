# Connecting the mobile app

**Applies to:** OpenValens 0.1.0 · Last updated: 2026-10-14

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

The build-time configuration above was checked with `varlock load`. Signing
in on a physical device against a self-hosted instance has not been verified
for 0.1.0.
