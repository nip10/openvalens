# Releasing

Last updated: 2026-10-29

How a version of OpenValens is cut: the version bump, the tag, the GitHub
Release with its notes and self-host upgrade notes, and the store builds of
the mobile app (Issue #306). Deploying a server is a separate, authorised
procedure: [release.md](release.md) (artifacts, migration plan, rollback) and
[Upgrading](self-hosting/upgrading.md) for self-hosters.

## The rules

- **One version.** The root `package.json` `version` is the release. The
  mobile app's store version (`apps/native/app.json` → `expo.version`) and the
  version the server reports at `GET /.well-known/openvalens` (`serverVersion`,
  `SERVER_VERSION` in `packages/api/src/server-meta.ts`) always equal it. A
  test fails when they disagree (`scripts/release-version.test.ts`).
- **One tag per release:** `vMAJOR.MINOR.PATCH`, on a commit of `main` whose
  CI is green. No pre-release suffixes: App Store Connect only accepts plain
  numbers as a version.
- **Build numbers are EAS's.** `eas.json` sets `appVersionSource: remote`, and
  the `production` profile auto-increments, so every store build gets a new
  build number without a commit.
- **Store builds come only from a release tag** in `nip10/openvalens`. That is
  what lets them carry the OpenValens name ([TRADEMARK.md](../TRADEMARK.md)), and
  the tag is the exact source that [LICENSE-APP-STORE](../LICENSE-APP-STORE)
  requires to be public. The app's About screen links to it:
  `https://github.com/nip10/openvalens/tree/v<version>`.
- **`apiVersion` is not the release version.** Bump `SERVER_API_VERSION` only
  for a change an older app cannot follow, and widen `APP_API_RANGE` in
  `apps/native/lib/server/server-meta.ts` in the same release when the app
  learns the new API. The store app talks to self-hosted servers of many
  versions; see [Connecting the mobile app](self-hosting/mobile-app.md).

## Cut a release

### 1. Bump the version (pull request)

```bash
git fetch origin && git switch -c release/vX.Y.Z origin/main
bun run release:version X.Y.Z
```

This sets `package.json`, `apps/native/app.json` and `SERVER_VERSION`, and the
**Applies to** line of every page in `docs/self-hosting` and `docs/reference`.
It lists those pages: read the ones the release changed and update what no
longer holds. `bun run release:version --check` (or `--check vX.Y.Z`) checks
that everything agrees.

In the same pull request, write the notes in `docs/releases/vX.Y.Z.md` (template
below). Merge when CI is green.

### 2. Tag

```bash
git switch main && git pull --ff-only
bun run release:version --check vX.Y.Z
git tag -a vX.Y.Z -m "OpenValens vX.Y.Z"   # or -s to sign it
git push origin vX.Y.Z
```

Pushing the tag starts two workflows:

| Workflow                                                        | Does                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`release.yml`](../.github/workflows/release.yml)               | Checks the versions equal the tag, then creates a **draft** GitHub Release with `docs/releases/vX.Y.Z.md` as its notes (generated notes if it is missing) |
| [`release-mobile.yml`](../.github/workflows/release-mobile.yml) | Runs the checks at the tag, then starts `eas build --profile production --platform all`, with `--auto-submit` when submit is configured                   |

Both can be re-run for an existing tag from the Actions tab (**Run
workflow**, with the tag). The mobile one also takes a platform and whether to
submit.

### 3. Publish the GitHub Release

Open the draft on the Releases page, check the notes, and publish it. The tag
is already public, so the source is available as soon as the tag is pushed;
publishing only announces it.

### 4. Mobile builds and review

The builds run on EAS, not on the GitHub runner (`--no-wait`); follow them on
expo.dev. With submit configured, each finished build goes to **TestFlight**
(iOS) and the **internal testing** track (Google Play). From there:

1. Test the build from TestFlight and Play internal testing (the
   [pre-submission checklist](mobile-release.md#pre-submission-checklist)).
2. iOS: in App Store Connect, add the build to the version `X.Y.Z`, fill in
   What's New, and submit for review.
3. Android: promote the release in the Play Console, internal → closed →
   production (a personal developer account needs a 14-day closed test with
   testers before production).

Without submit configured, or for a re-run:

```bash
cd apps/native
bunx eas-cli submit --profile production --platform ios --latest
bunx eas-cli submit --profile production --platform android --latest
```

### Release notes template

`docs/releases/vX.Y.Z.md`:

```markdown
## Highlights

- <what people will notice, in plain words>

## Self-hosting: upgrade notes

- Upgrade: `git fetch --tags && git checkout vX.Y.Z && deploy/setup.sh upgrade`
  ([Upgrading](https://github.com/nip10/openvalens/blob/vX.Y.Z/docs/self-hosting/upgrading.md)).
- Migrations: <none | list; the upgrade takes a pre-migrate backup first>
- New or changed settings: <none | names, defaults, whether you must act>
- Breaking changes and manual steps: <none | what and how>
- Mobile app: server API version <n>. The store app <version> works with
  servers from <version> on.

## Mobile app

- iOS and Android <X.Y.Z> (build numbers from EAS). Native change: <yes | no>.

## Source

https://github.com/nip10/openvalens/tree/vX.Y.Z — AGPL-3.0-or-later with the
app-store permission (LICENSE-APP-STORE).
```

## Over-the-air updates: not for now

`expo-updates` (EAS Update) could ship JavaScript-only fixes to installed
apps without a store review. **The recommendation is not to use it for the
launch**, and to revisit once the store apps are live:

- **Source for every update.** Each update is a new conveyed version of the
  app, so under LICENSE-APP-STORE its exact source must be public and the app
  must point to it. Updates would need their own tags, and the About screen
  would have to show the update, not only the binary version.
- **One more third party.** The app would ask Expo's update service on launch,
  from every install, including those connected to a self-hosted server. That
  would have to go into the privacy policy, the subprocessor list (#300) and
  the store privacy answers (#307).
- **Silent compatibility changes.** The range of server API versions the app
  accepts (`APP_API_RANGE`) lives in JavaScript. An update could change which
  self-hosted servers the app works with, without a store release or a tag.
- **Small gain at launch.** Play internal testing is immediate, App Review
  usually takes a day or two, and Apple offers expedited review for urgent
  fixes. Adding a native module also adds risk to the first review.

If it is adopted later: add `expo-updates`, set `runtimeVersion` to
`{ "policy": "fingerprint" }` (a JS update then only reaches binaries with the
same native fingerprint), set `updates.url` from the EAS project, give each
build profile a `channel` (`preview`, `production`), publish only from a
release tag with `eas update --channel production`, and show the update id in
About. **Native changes always need a store build**: a new or upgraded native
module, a config plugin, a permission or entitlement, `app.json` native
settings, or an Expo SDK upgrade.

## One-time setup (owner)

Nothing below is in the repository; each item needs the owner's accounts.
Until the first two exist, `release-mobile.yml` reports what is missing and
stops without failing.

1. **Expo account and EAS project.** `cd apps/native && bunx eas-cli login &&
bunx eas-cli init` creates the project; copy its id (a UUID).
2. **GitHub:** repository **secret** `EXPO_TOKEN` (expo.dev → Account settings
   → Access tokens; a robot user's token is best) and repository **variable**
   `EXPO_PUBLIC_EAS_PROJECT_ID` (the UUID; not a secret, the app embeds it).
3. **EAS environment variables** (expo.dev → project → Environment variables),
   for `production` and `preview`:
   - `EXPO_PUBLIC_EAS_PROJECT_ID` (plain text): the same UUID; push needs it.
   - `GOOGLE_SERVICES_JSON` (**file**, secret): the Firebase
     `google-services.json` for `com.openvalens.app` (#305). EAS writes the
     file on the build machine and sets the variable to its path, which
     `app.config.ts` passes to Android.
4. **Credentials on EAS, created once by hand.** Run the first production
   build of each platform from a machine, interactively
   (`bunx eas-cli build --profile production --platform ios`, then
   `--platform android`): EAS creates and stores the iOS
   distribution certificate, provisioning profile and APNs key, and the
   Android upload keystore. CI builds with `--non-interactive` and can only
   reuse stored credentials. Upload the FCM v1 service account key with
   `eas credentials` → Android (#305).
5. **App Store Connect (#304).** Create the app record for
   `com.openvalens.app`, then put its **Apple ID** (App Store Connect → the
   app → App Information, a number like `6740000000`) in `apps/native/eas.json`
   at `submit.production.ios.ascAppId`, replacing `REPLACE_WITH_ASC_APP_ID`.
   Add an **App Store Connect API key** (Users and Access → Integrations, App
   Manager role) to EAS with `eas credentials` → iOS → App Store Connect API
   Key, so `eas submit` can upload without an Apple ID login.
6. **Google Play (#305).** Create the app for `com.openvalens.app`, and upload
   the **first** Android build by hand in the Play Console (Google requires
   it; until then, dispatch the workflow with platform `ios`, or with submit
   off). Create a Google Cloud service account with release permission in the
   Play Console, and add its JSON key to EAS with `eas credentials` → Android
   → Google Service Account (for submissions). `eas.json` submits to the
   `internal` track with release status `completed`.
7. **Optional:** a GitHub environment with required reviewers, if store builds
   should wait for an approval after the tag is pushed.

`scripts/eas-submit-config.ts` is what the workflow asks before submitting;
run `bun scripts/eas-submit-config.ts all` to see what is still missing.

## Later: container images per tag (#129)

Self-hosters build images on their own server today
([release.md §2](release.md#2-build-and-pin-release-artifacts)). Published
images would plug into `release.yml` as a second job after the version check:
build `apps/server/Dockerfile` at the tag, push
`ghcr.io/nip10/openvalens-server:vX.Y.Z` (`packages: write`), record the digest
with `scripts/release-manifest.ts`, and attach the manifest to the draft
Release. The web image is not generic yet, because `VITE_SERVER_URL` is
compiled into it; it needs a runtime server address first.
