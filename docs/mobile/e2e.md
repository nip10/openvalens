# Mobile end-to-end tests (Maestro)

**Applies to:** the Expo app in `apps/native` · Last updated: 2026-10-29

The mobile app has an end-to-end suite written with
[Maestro](https://docs.maestro.dev). It drives a real build of the app on the
iOS simulator and the Android emulator against a local server seeded with the
synthetic demo account (#301), walks every main flow, and takes a screenshot of
every screen in light and dark mode, in English and Portuguese (Portugal).

It runs on a developer Mac. There is no CI job yet (macOS runners cost money);
see [Follow-ups](#follow-ups).

```sh
bun run e2e:ios        # suite + screenshot tour on the iOS simulator
bun run e2e:android    # the same on the Android emulator
```

Each run starts from a clean seed and prints a PASS/FAIL line per flow, the
path of the Maestro artifacts and the path of the screenshot folder.

## What it covers

| Flow                               | What it checks                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 01 Server choice                   | Empty, invalid, plain-HTTP, unreachable and non-OpenValens addresses; Cloud in one tap; own server   |
| 02 Sign-up and sign-in             | "Create an account" opens the web sign-up; a new Cloud account; email validation; magic-link sign-in |
| 03 Onboarding                      | Age check, focus and modules, data sources, basics, a goal, privacy, then the dashboard              |
| 04 Navigation                      | Every tab, every drawer screen and the screens without a drawer item load without an error           |
| 05 Food and water                  | Search and one-tap log, quick add, the barcode entry point, plain water, "Describe a meal"           |
| 06 Strength workout                | Start, add an exercise, two sets (weight × reps, done), finish, history                              |
| 07 Body, vitals and labs           | Weight, a private body measurement, a vital reading, a lab result                                    |
| 08 Sleep, activity and health data | Sleep and activity views; the Apple Health / Health Connect permission screen                        |
| 09 Coach                           | AI opt-in (workspace and personal), a conversation answered by a stub model                          |
| 10 Settings                        | Sign-in methods, language en ⇄ pt-PT, lab units and date format, dark mode, modules                  |
| 11 Sharing and invitations         | The owner invites someone; they see the invitation and accept it                                     |
| 12 Read-only Cloud state           | Subscription ended: the read-only notice, no purchase UI, writes refused, export still works         |
| 13 Export and delete account       | JSON bundle and per-domain export; "Delete everything" with the typed confirmation                   |
| Screenshot tour (×4)               | Every screen, the sign-in and server-choice screens and each onboarding step, per language × theme   |

The barcode scanner needs a camera and is only opened as far as its entry
point. Google and Apple sign-in are shown but never tapped (they need the real
providers).

## How it works

```
run.ts ─┬─ Postgres container ──── demo seed (#301, --cloud, today's date)
        ├─ server (DEPLOYMENT_MODE=cloud, EMAIL_DRY_RUN, dev magic-link sink)
        ├─ helper (loopback): magic links, sign-up, subscription state, stub AI
        └─ maestro test .maestro/  →  report.xml, screenshots
```

- **The app is a release build** made for tests: JavaScript bundled in, no
  dev launcher, dev menu, tools button or LogBox, so flows are steady and
  screenshots look like the store app. It is built with
  `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`, which lets a release build use plain
  HTTP to localhost or the local network (a development build always may) and
  turns on Android cleartext traffic. Store builds never set it.
- **The server** runs in Cloud mode with fixed throwaway secrets
  (`apps/native/e2e/server-env.ts`): placeholder Stripe values (the app never
  talks to Stripe), a placeholder Google client (so the Google button and
  Settings › Sign-in methods show) and the helper as an OpenAI-compatible AI
  provider.
- **Sign-in never sends email.** The server prints sign-in links through the
  dev magic-link sink (`devMagicLinkSink`). A flow asks for a link in the app,
  then `scripts/magic-link.js` asks the helper for the newest printed link;
  the helper follows it with redirects off and answers with the
  `openvalens://…?cookie=…` callback, which the flow opens with `openLink`.
  That is exactly what the browser hands the app after a tap on the emailed
  link.
- **Sign-up**: the app's "Create an account" opens the web sign-up page. The
  server refuses public sign-up while email is a dry run, so the helper creates
  the account the way the emailed sign-up link does (a `sign_up_request` row,
  then the real verify endpoint, which starts the 30-day trial).
- **Read-only state**: the helper moves the owner's subscription to `ended`
  and back (`/subscription?email=…&status=ended|trialing`).
- **The Android emulator** reaches the server and the helper through
  `adb reverse`, so the app uses `http://localhost:<port>` on both platforms.
- **Ports** (override with the variable of the same name): Postgres
  `E2E_PG_PORT=55451`, server `E2E_SERVER_PORT=3410`, helper
  `E2E_HELPER_PORT=3411`. Everything binds to loopback.

### Files

| Path                                   | What                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `apps/native/.maestro/config.yaml`     | Workspace: which flows, in which order                            |
| `apps/native/.maestro/flows/`          | One file per flow above; they share one app session, in order     |
| `apps/native/.maestro/subflows/`       | Reusable steps: sign-in, drawer navigation, find, fill and save…  |
| `apps/native/.maestro/screenshots/`    | The screenshot tour                                               |
| `apps/native/.maestro/scripts/`        | Maestro JavaScript that calls the helper                          |
| `apps/native/e2e/run.ts`               | The runner behind `bun run e2e:*`                                 |
| `apps/native/e2e/stack.ts`             | Postgres, seed, server, helper                                    |
| `apps/native/e2e/helper.ts`            | The helper and the stub AI                                        |
| `apps/native/e2e/devices.ts`           | Simulator, emulator and the e2e build                             |
| `apps/native/e2e/screenshot-index.ts`  | Writes `index.html` for a screenshot folder                       |
| `apps/native/e2e-artifacts/` (ignored) | Output: `runs/<date>/<platform>/`, `screenshots/<date>/`, `logs/` |

## Setup (once)

1. **Bun, Docker** (for Postgres) and `bun install` at the repository root.
2. **Maestro** 2.x: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
   (installs to `~/.maestro/bin`; Java 17 is needed). `run.ts` finds it there or
   on `PATH`.
3. **iOS**: Xcode with an iOS simulator runtime. The suite creates and boots its
   own simulator, `OpenValens-E2E` (an iPhone 17 Pro; `E2E_IOS_SIMULATOR` and
   `E2E_IOS_DEVICE_TYPE` change that). It never touches other simulators.
4. **Android**: the command-line tools with `platform-tools`, `emulator`, a
   system image and an AVD named `ov-e2e` (`E2E_ANDROID_AVD` changes the name).
   With Homebrew's `android-commandlinetools`:

   ```sh
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   sdkmanager "platform-tools" "emulator" "system-images;android-36;google_apis_playstore;arm64-v8a"
   echo no | avdmanager create avd -n ov-e2e -k "system-images;android-36;google_apis_playstore;arm64-v8a" -d pixel_7
   ```

   `run.ts` boots the AVD if it is not running.

The first run builds the app (`expo prebuild` and a release build, several
minutes); later runs reuse the installed app. Pass `--build` after changing the
app's code, since the JavaScript is bundled into the build.

## Running

```sh
bun run e2e:android -- --build          # rebuild the app, then everything
bun run e2e:ios -- --no-screenshots     # the suite only
bun run e2e:ios -- --screenshots-only   # the tour only
bun run e2e:ios -- --flows 01,02,03     # some flows (each needs those before it)
bun run e2e:ios -- --keep               # leave the server up afterwards
bun apps/native/e2e/run.ts stack        # just the seeded server and helper
```

With the stack up (`run.ts stack` or `--keep`), run one flow straight away:

```sh
cd apps/native
maestro --device <udid or emulator-5554> test \
  -e SERVER_URL=http://localhost:3410 -e HELPER_URL=http://localhost:3411 \
  .maestro/flows/05-food-and-water.yaml
```

### Screenshots

`apps/native/e2e-artifacts/screenshots/<date>/` holds
`<platform>/<locale>-<theme>/*.png` from the tour and `<platform>/flows/*.png`
taken during the flows, with an `index.html` that lines the same screen up
across platform, language and theme. The data is the synthetic demo account
only. The folder is git-ignored; share it as a zip.

## Adding a flow

1. Add `apps/native/.maestro/flows/NN-name.yaml` with `name: NN Name`, and add
   that name to `flowsOrder` in `config.yaml`.
2. Start from a known place: `runFlow: ../subflows/fresh-start.yaml` restarts
   the app signed in (as whoever the previous flow left signed in), and
   `../subflows/switch-account.yaml` with `EMAIL` signs a given account in.
3. Move with ids, not text: `drawer-go.yaml` with `ID: drawer-<route>`, tabs by
   `tab-<name>`, and `find-id.yaml` / `find-text.yaml` to scroll something into
   view (screens keep their scroll position, so they look up first).
4. Fill forms with `fill-and-save.yaml` (an input id, a value, the button
   below it) and hide the keyboard with `hide-keyboard.yaml`, never with a bare
   `hideKeyboard`: on Android that presses Back when no keyboard is up and
   leaves the screen.
5. Give a control a `testID` when a flow needs it and its text is not unique or
   is translated. Keep them small and stable (`set-weight-1`,
   `module-switch-food`).
6. Take screenshots with `takeScreenshot: NN-what`; `run.ts` collects them.
7. A new screen also belongs in the tour: add it to
   `subflows/visit-all-screens.yaml`.

Things that trip flows up:

- Maestro matches text as a regular expression over the whole text: escape
  `?`, `(`, `.` (`"Change server\\?"`).
- Some confirmations ("Entry saved.") are screen-reader announcements, not
  text on screen; assert on the result instead (the form clears, the row is
  listed).
- iOS asks "Open in “OpenValens”?" when a link opens the app;
  `subflows/open-link.yaml` accepts it.
- Maestro grants every permission on launch unless told not to; flow 01
  launches with `permissions: { all: deny }` so permission screens are real.

## Follow-ups

- A manual (`workflow_dispatch`) or nightly GitHub Actions job on a macOS
  runner, uploading the screenshot folder as an artifact.
- Google and Apple sign-in end to end need test accounts with the real
  providers; today they are only shown.
