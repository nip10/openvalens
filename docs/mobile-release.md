# Mobile release (EAS)

**Applies to:** the Expo app in `apps/native` · Last updated: 2026-10-26

How to build and submit the iOS and Android apps with
[EAS Build](https://docs.expo.dev/build/introduction/) and
[EAS Submit](https://docs.expo.dev/submit/introduction/). Nothing in the
repository runs these for you: every command below needs an Expo account and
the owner's Apple and Google credentials, and creates resources on Expo's
servers. Self-hosters building for their own instance should read
[Connecting the mobile app](self-hosting/mobile-app.md) first.

## What is already set up

| Thing             | Where                               | Value                                                                   |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| App name          | `apps/native/app.json`              | OpenValens                                                              |
| iOS bundle id     | `app.json` → `ios.bundleIdentifier` | `com.openvalens.app`                                                    |
| Android package   | `app.json` → `android.package`      | `com.openvalens.app`                                                    |
| URL scheme        | `app.json` → `scheme`               | `openvalens` (magic-link sign-in returns here)                          |
| Marketing version | `app.json` → `version`              | `1.0.0`; bump it by hand for each store release                         |
| Build numbers     | `eas.json` → `cli.appVersionSource` | `remote`: EAS keeps them; `production` auto-increments                  |
| Icon and splash   | `apps/native/assets/images`         | Rendered from `assets/source/mark.svg` by `bun scripts/render-icons.ts` |
| Server address    | chosen in the app on first launch   | Cloud or a self-hosted origin; `EXPO_PUBLIC_SERVER_URL` locks a build   |
| Push project id   | `app.config.ts`                     | `EXPO_PUBLIC_EAS_PROJECT_ID` (optional; push is off without it)         |
| FCM config        | `app.config.ts`                     | `GOOGLE_SERVICES_JSON` (optional; Android push only)                    |

### Build profiles (`apps/native/eas.json`)

| Profile       | For                                                                                           | Distribution                               |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `development` | A dev client (`expo-dev-client`) on a simulator or an Android emulator, loading JS from Metro | internal, iOS simulator build, Android APK |
| `preview`     | Testers' phones (TestFlight is not needed)                                                    | internal (ad hoc iOS, Android APK)         |
| `production`  | App Store and Google Play                                                                     | store                                      |

No profile sets a server (#295). On first launch the app asks: OpenValens
Cloud (`https://app.openvalens.com`) or the address of a self-hosted server,
which it checks against `GET /.well-known/openvalens` before saving.
Settings → Server changes it later. A development build also accepts plain
HTTP to localhost or the local network, for a server on your machine.

`EXPO_PUBLIC_SERVER_URL` is optional. Set it (in a profile's `env`, or in
`apps/native/.env.local` for a local build) to lock a build to one server:
the app then skips the choice and hides "Change server". EAS builds take the
value from the profile's `env`, not from your shell, so to lock a build to
another instance add a profile (for example
`"staging": { "extends": "preview", "env": { ... } }`).

## What the owner must provide

1. **An Expo account** and `eas login` on the machine that runs the builds
   (`bunx eas-cli login`). Then, once, `cd apps/native && bunx eas-cli init`
   to create the EAS project. Because the app uses `app.config.ts`, EAS cannot
   write the project id itself: put the UUID it prints into the EAS project's
   environment variables as `EXPO_PUBLIC_EAS_PROJECT_ID` (all profiles), or
   export it before building. Push notifications need it.
2. **Apple:** a paid Apple Developer Program membership and its Team ID; an
   App Store Connect app record for bundle id `com.openvalens.app` (name,
   primary language, SKU). EAS creates the distribution certificate and
   provisioning profiles on the first `eas build` (it asks for your Apple ID
   login, or an App Store Connect API key for CI). For submission, an App
   Store Connect API key (Issuer ID, Key ID, `.p8`) is the least fragile.
   For push, let EAS create the APNs key when it asks.
3. **Google:** a Google Play Console developer account; an app created in the
   console with package `com.openvalens.app`; a Google Cloud service account
   JSON with release permission for `eas submit`. The very first Android
   upload must be done by hand in the Play Console (Google's rule); later
   ones can use `eas submit`. For push, a Firebase project with an Android app
   for the same package: its `google-services.json` (set `GOOGLE_SERVICES_JSON`
   to its path, or upload it as an EAS file secret) and the FCM V1 service
   account key uploaded to EAS (`eas credentials`).

## Build and submit

Run from `apps/native`:

```bash
# A simulator dev client (needs Metro: bun run dev, then open the app)
bunx eas-cli build --profile development --platform ios

# Internal builds for testers
bunx eas-cli build --profile preview --platform all

# Store builds, then send them to App Store Connect / Google Play
bunx eas-cli build --profile production --platform all
bunx eas-cli submit --profile production --platform ios --latest
bunx eas-cli submit --profile production --platform android --latest
```

Local builds without EAS still work for development: `bunx expo run:ios`,
then choose "My own server" and enter `http://localhost:3000` (or lock the
build with `EXPO_PUBLIC_SERVER_URL=http://localhost:3000 bunx expo run:ios`). The `ios/`
and `android/` folders this generates are not committed.

## Health data notes

- **HealthKit (iOS).** The `@kingstinct/react-native-healthkit` plugin adds
  the HealthKit entitlement, background delivery and the read-only usage text
  ("OpenValens reads your health data from Apple Health…"); the app never
  writes to Health (`NSHealthUpdateUsageDescription` is off). The App ID
  needs the HealthKit capability: EAS enables it when it syncs capabilities.
  App Review expects the health data use to be visible in the app and
  described in the privacy policy, and the App Privacy answers must declare
  Health and Fitness data as collected and linked to the user, not used for
  tracking. HealthKit works on the simulator, with no real data.
- **Health Connect (Android).** `react-native-health-connect` and the
  permissions in `app.json` (`READ_STEPS`, `READ_HEART_RATE`, `READ_SLEEP`,
  `READ_WEIGHT`, `READ_BODY_FAT`, `READ_ACTIVE_CALORIES_BURNED`,
  `READ_DISTANCE`, `READ_EXERCISE`, background and history reads). Google
  Play requires the **Health Connect permissions declaration** form in the
  Play Console, a privacy policy that names each data type, and a short
  video of the flow for each permission. Expect review to take longer than
  usual. `minSdkVersion` is 26.
- **Camera:** used only to scan food barcodes (the usage text is in
  `app.json`).

## Pre-submission checklist

- [ ] `version` in `app.json` bumped; release notes written.
- [ ] `cd apps/native && bun run check-types && bun test` pass; `bun run i18n:check` passes at the root.
- [ ] `bunx expo export --platform ios --platform android` bundles without errors.
- [ ] Icon, splash and adaptive icon look right on a device in light and dark mode (re-render with `bun scripts/render-icons.ts` if the mark changed).
- [ ] The `production` profile points at the right server, and that server's `BETTER_AUTH_URL` / trusted origins accept the `openvalens://` scheme (magic-link sign-in returns there).
- [ ] Sign-in by magic link, Apple Health / Health Connect permission prompts and sync, and push registration tested on a real phone from a `preview` build.
- [ ] Privacy policy URL, support URL, App Privacy (iOS) and Data safety (Google) answers filled in; Health Connect declaration submitted.
- [ ] Screenshots for each required device size (6.9" and 6.5" iPhone, 13" iPad because `supportsTablet` is on; Play phone and 7"/10" tablet if listed).
- [ ] Age rating questionnaires answered (health information, no user-generated content shared publicly).
- [ ] Medical disclaimer visible in the store description: OpenValens is not a medical device and gives no diagnosis.
- [ ] `EXPO_PUBLIC_EAS_PROJECT_ID` set and push tested, or push knowingly shipped off.
