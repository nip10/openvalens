# Mobile release (EAS)

**Applies to:** the Expo app in `apps/native` · Last updated: 2026-11-14

How to build and submit the iOS and Android apps with
[EAS Build](https://docs.expo.dev/build/introduction/) and
[EAS Submit](https://docs.expo.dev/submit/introduction/). Nothing in the
repository runs these for you: every command below needs an Expo account and
the owner's Apple and Google credentials, and creates resources on Expo's
servers. Self-hosters building for their own instance should read
[Connecting the mobile app](self-hosting/mobile-app.md) first.

## What is already set up

| Thing             | Where                               | Value                                                                              |
| ----------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| App name          | `apps/native/app.json`              | OpenValens                                                                         |
| iOS bundle id     | `app.json` → `ios.bundleIdentifier` | `com.openvalens.app`                                                               |
| Android package   | `app.json` → `android.package`      | `com.openvalens.app`                                                               |
| URL scheme        | `app.json` → `scheme`               | `openvalens` (magic-link sign-in returns here)                                     |
| Marketing version | `app.json` → `version`              | The release version; `bun run release:version` sets it ([Releasing](releasing.md)) |
| Build numbers     | `eas.json` → `cli.appVersionSource` | `remote`: EAS keeps them; `production` auto-increments                             |
| Icon and splash   | `apps/native/assets/images`         | Rendered from `assets/source/mark.svg` by `bun scripts/render-icons.ts`            |
| Server address    | chosen in the app on first launch   | Cloud or a self-hosted origin; `EXPO_PUBLIC_SERVER_URL` locks a build              |
| Push project id   | `app.config.ts`                     | `EXPO_PUBLIC_EAS_PROJECT_ID` (optional; push is off without it)                    |
| FCM config        | `app.config.ts`                     | `GOOGLE_SERVICES_JSON` (optional; Android push only)                               |

### Build profiles (`apps/native/eas.json`)

| Profile       | For                                                                                           | Distribution                               |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `development` | A dev client (`expo-dev-client`) on a simulator or an Android emulator, loading JS from Metro | internal, iOS simulator build, Android APK |
| `preview`     | Testers' phones (TestFlight is not needed)                                                    | internal (ad hoc iOS, Android APK)         |
| `production`  | App Store and Google Play                                                                     | store                                      |

Each profile reads the EAS environment of the same name (`environment` in
`eas.json`), which is where `EXPO_PUBLIC_EAS_PROJECT_ID` and the
`GOOGLE_SERVICES_JSON` file secret live. `submit.production` sends iOS builds
to TestFlight (`ascAppId`, a placeholder until #304) and Android builds to the
Play `internal` track. Store builds of a release run from a tag in CI; see
[Releasing](releasing.md).

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

For a release, push the tag and let `release-mobile.yml` do this
([Releasing](releasing.md)). By hand, run from `apps/native`:

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
  writes to Health. `NSHealthUpdateUsageDescription` is still set, to a text
  saying so: the library references the write APIs, and App Store Connect
  rejects an upload without it (ITMS-90683, every build before 1.0.1). The App ID
  needs the HealthKit capability: EAS enables it when it syncs capabilities.
  App Review expects the health data use to be visible in the app and
  described in the privacy policy, and the App Privacy answers must declare
  Health and Fitness data as collected and linked to the user, not used for
  tracking. HealthKit works on the simulator, with no real data.
- **Health Connect (Android).** `react-native-health-connect` and the
  permissions in `app.json` (`READ_STEPS`, `READ_HEART_RATE`, `READ_SLEEP`,
  `READ_WEIGHT`, `READ_BODY_FAT`, `READ_ACTIVE_CALORIES_BURNED`,
  `READ_DISTANCE`, `READ_EXERCISE`, `READ_MINDFULNESS` (#452, asked only when
  a tracker is linked), background and history reads). Google
  Play requires the **Health Connect permissions declaration** form in the
  Play Console, a privacy policy that names each data type, and a short
  video of the flow for each permission. Expect review to take longer than
  usual. `minSdkVersion` is 26.
- **Camera:** used only to scan food barcodes (the usage text is in
  `app.json`).
- **Bluetooth:** used only to connect to a device the person chooses to pair
  (`@config-plugins/react-native-ble-plx`, usage text in `app.json`). On
  Android, two local modules (`apps/native/modules/bt-classic`,
  `pebble-bond`) add `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN`.

## iOS app extensions: the home-screen widget

The quick-log widget (#449, PR #499) is an iOS WidgetKit extension built at
prebuild by `@bacons/apple-targets` from `apps/native/targets/quick-log-widget`.
It has its own bundle id, `com.openvalens.app.quicklogwidget`, so it needs its
own App ID and provisioning profile. It has no App Group and no other
capability, and it shows no health data on iOS: its three buttons only open
`openvalens://quick-log?widget=…`. On Android the widget is a receiver inside
the app package and needs nothing extra: the receiver is not exported, and it
records each water or "Taken" tap before it opens the app
(`apps/native/modules/home-widget-tap`, #505), so only a real tap on the
widget saves at once. The same link opened by another app or page waits for
one "Save" tap, as every iOS tap does.

**Nothing goes in `eas.json`.** `eas.json` has no setting for extensions or
their entitlements. The plugin writes the extension into the app config
(`extra.eas.build.experimental.ios.appExtensions`), which is where EAS looks
for the targets to sign, and the widget has no entitlements to declare
(checked on 1.2.0, with `ios.appleTeamId` still unset). To see it:

```bash
cd apps/native
bunx expo config --type prebuild --json | jq '.extra.eas.build.experimental.ios.appExtensions'
# → [{ "bundleIdentifier": "com.openvalens.app.quicklogwidget", "targetName": "QuickLogWidget" }]
```

**Once, before the first store build with the widget** (the owner; CI builds
with `--non-interactive` and can only reuse stored credentials, so a tag build
without the extension's profile fails):

1. **Set `ios.appleTeamId`.** Find the Team ID (10 characters) at
   developer.apple.com → Account → Membership details. It is the same value
   as the server's `APPLE_TEAM_ID` for Sign in with Apple. Add
   `"appleTeamId": "<TEAM ID>"` under `expo.ios` in `apps/native/app.json`
   in a pull request; it is not a secret. Without it `@bacons/apple-targets`
   warns "Expo config is missing required ios.appleTeamId" and the
   extension's Xcode target has no development team. EAS applies its own
   profiles to every target, so builds can sign without it, but set it so
   prebuilds and local Xcode builds match.
2. **Register the extension and create its credentials:**

   ```bash
   cd apps/native
   bunx eas-cli credentials --platform ios
   # → production → it lists OpenValens (com.openvalens.app) and
   #   QuickLogWidget (com.openvalens.app.quicklogwidget)
   # → Build Credentials → set up all the required credentials
   # → sign in with the Apple ID of the team
   ```

   EAS registers the App ID `com.openvalens.app.quicklogwidget` in the Apple
   Developer portal, reuses the existing distribution certificate and creates
   an App Store provisioning profile for the extension. Leave the extension's
   capabilities empty: it needs no App Group, HealthKit or push. Do the same
   for `preview` if you build preview (ad hoc) builds; its profile must list
   the test devices. Running the first production build interactively
   (`bunx eas-cli build --profile production --platform ios`) does the same.

   To register the App ID by hand instead: developer.apple.com →
   Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App →
   Explicit Bundle ID `com.openvalens.app.quicklogwidget`, no capabilities.
   Then run `eas credentials` as above to create the profile.

3. **Check** with `bunx eas-cli credentials --platform ios` that both targets
   have a valid distribution certificate and provisioning profile, then push
   the tag.

App Store Connect needs nothing for the extension: it ships inside the app,
and it adds no purpose string or App Privacy answer.

### Later: saving from the iOS widget (App Intents, needs an App Group)

On iOS a widget tap opens the app with the entry ready and one "Save" tap
(#505). Saving from the widget without opening the app takes an interactive
button (`Button(intent:)`, iOS 17+, already the extension's deployment
target), and its App Intent's `perform()` runs in the widget extension's
process. That process has no session and no data: #449 settled on no App
Group and no shared keychain for v1. A v2 would need, with the owner's
decision first:

1. **An App Group** (`group.com.openvalens.app`) on both App IDs
   (`com.openvalens.app` and `com.openvalens.app.quicklogwidget`):
   `ios.entitlements` in `app.json`, `entitlements` in
   `targets/quick-log-widget/expo-target.config.js`, new provisioning
   profiles from `eas credentials`, and the "no App Group" check in
   `app.config.test.ts` changed.
2. **A snapshot the widget can read**: the app writes the buttons, the next
   due supplement (id and dose), whether the active workspace is the
   member's own, and (opt-in) the values to the group's `UserDefaults`, and
   asks WidgetKit to reload, as the Android widget's snapshot already does.
   That takes a small native module. Sign-out clears it.
3. **A write path from the extension**, one of:
   - _A queue (no credential in the extension):_ `perform()` appends
     `{ action, at, clientMutationId }` to a file in the group, and the app
     drains it into its offline outbox on next open or background task.
     Writes land late, and there is no Undo.
   - _A scoped token:_ a new server endpoint issues a per-device token that
     can only add water and supplement intakes to the owner's own record,
     kept in a shared keychain access group (`keychain-access-groups`) and
     revoked on sign-out. Writes land at once. Sharing the full Better Auth
     session instead is not recommended.
4. **The same guards**: own record only (checked again by the server for a
   scoped token), kinds turned off, the 10 s repeat window, and a line on the
   widget saying what was saved, since it has no Undo.

Without an App Group, an App Intent that opens the app (`openAppWhenRun`) and
runs `perform()` in the app could record the tap the way the Android receiver
does, and give one-tap saves with Undo and no public link. It still opens the
app, puts Swift in the main app target through a config plugin, and which
process runs `perform()` has to be checked on a device first.

## Pre-submission checklist

- [ ] Version bumped with `bun run release:version`, release notes in `docs/releases/`, tag pushed ([Releasing](releasing.md)).
- [ ] `cd apps/native && bun run check-types && bun test` pass; `bun run i18n:check` passes at the root.
- [ ] `bunx expo export --platform ios --platform android` bundles without errors.
- [ ] Icon, splash and adaptive icon look right on a device in light and dark mode (re-render with `bun scripts/render-icons.ts` if the mark changed).
- [ ] OpenValens Cloud (`https://app.openvalens.com`) runs a server this version supports, and its `BETTER_AUTH_URL` / trusted origins accept the `openvalens://` scheme (magic-link sign-in returns there).
- [ ] Sign-in by magic link, Apple Health / Health Connect permission prompts and sync, and push registration tested on a real phone from a `preview` build.
- [ ] Privacy policy URL, support URL, App Privacy (iOS) and Data safety (Google) answers filled in; Health Connect declaration submitted.
- [ ] Screenshots for each required device size (6.9" iPhone; no iPad, since `supportsTablet` is off; Play phone and feature graphic, 7"/10" tablet if listed).
- [ ] Age rating questionnaires answered (health information, no user-generated content shared publicly).
- [ ] Medical disclaimer visible in the store description: OpenValens is not a medical device and gives no diagnosis.
- [ ] `EXPO_PUBLIC_EAS_PROJECT_ID` set and push tested, or push knowingly shipped off.
- [ ] Every iOS target has credentials on EAS (`bunx eas-cli credentials --platform ios`), including app extensions such as the [home-screen widget](#ios-app-extensions-the-home-screen-widget).
- [ ] What's New written for the version: `releaseNotes` in `apps/native/store.config.json` (App Store) and `apps/native/store/play/<locale>/changelogs/default.txt` (Play), in en-US and pt-PT; `bun test apps/native/store` passes.
- [ ] A new Health Connect permission or HealthKit type has its Play declaration and App Review note ([Store listings](store-listings.md#google-health-connect-permissions-declaration)).
