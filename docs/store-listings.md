# Store listings

**Applies to:** the App Store and Google Play listings of `apps/native` · Last updated: 2026-10-29

The listing text, App Privacy answers (Apple) and Data safety answers (Google)
for the store app (#307). The text is in the repository so it is reviewed like
code; `apps/native/store/listing.test.ts` keeps it inside the store limits and
the wording rules. `[CONFIRM]` marks a fact the owner checks before submitting.

## Where the text lives

| Store       | File                                                               | How it gets to the store                                                                    |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| App Store   | `apps/native/store.config.json` (`en-US`, `pt-PT`)                 | `cd apps/native && eas metadata:push` ([EAS Metadata](https://docs.expo.dev/eas/metadata/)) |
| Google Play | `apps/native/store/play/<locale>/*.txt` (fastlane `supply` layout) | Paste into Play Console › Store presence › Main store listing, or `fastlane supply`         |

Both use the same description. The only difference is the health platform:
Apple Health on iOS, Health Connect on Android.

**Wording rules** (checked by the test, in both languages):

- No term from the landing site's banned list (`apps/site/scripts/wording-rules.ts`)
  or its Portuguese counterparts, outside the intended-purpose statement.
- Every full description ends with the intended-purpose statement, the same
  text as the landing site.
- No price, trial or purchase wording in either store. The app has no purchase
  flow and Cloud is paid for on the web (App Store guideline 3.1.3(f)).
- Every full description gives the source code URL. This is the notice that
  `LICENSE-APP-STORE` requires.

## Owner decisions before submitting

1. **iPad.** `ios.supportsTablet` is `true` in `app.json`, so App Store Connect
   requires iPad screenshots (13"). Either keep it and add iPad screenshots, or
   set it to `false` before the first build. The app is designed for phones.
2. **Support and privacy URLs.** `store.config.json` points to
   `https://openvalens.com/support` and `https://openvalens.com/privacy`. The
   legal pages ship with #309 after #300 is approved. Both URLs must be live
   before review.
3. **Account deletion URL (Google).** Play requires a web link where people can
   ask to delete their account. Use the web app's Settings page
   (`https://app.openvalens.com/settings`, which has **Delete account and all
   data**) or a page on the site that explains it. `[CONFIRM]`
4. **Owner review** of the pt-PT text. It is written in the app's formal
   register (`o seu`, `introduza`).

## Screenshots

Six screens per locale (Cockpit, Labs, Meal diary, Training, Sleep, Body) on the
synthetic demo account (#301), light mode, captured by the Maestro suite (#302):

| Store       | Files                                                                                     | Size                          |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| App Store   | `apps/native/store/app-store/screenshots/<en-US\|pt-PT>/iphone-6.9/NN-screen.png`         | 1320×2868 (iPhone 17 Pro Max) |
| Google Play | `apps/native/store/play/<en-US\|pt-PT>/images/phoneScreenshots/N.png` (fastlane `supply`) | 1080×2400 (Pixel 7 emulator)  |

Regenerate them with `bun run e2e:ios -- --store` (on an iPhone Pro Max
simulator) and `bun run e2e:android -- --store`; see
[Mobile end-to-end tests](mobile/e2e.md#store-screenshots-307). They are plain
app screenshots: no captions or device frames yet. `[CONFIRM]` whether to add
captions in the Bloom look before submitting. Still missing: iPad 13" (only if
`supportsTablet` stays on) and the Play feature graphic (1024×500).

| Store       | Required                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| App Store   | iPhone 6.9" (1320×2868 or 1290×2796), 3–10 per locale; iPad 13" (2064×2752) only if `supportsTablet` stays on                            |
| Google Play | Phone screenshots, 2–8, 16:9 or 9:16, 320–3840 px per side; feature graphic 1024×500 PNG/JPEG; app icon 512×512 (from `render-icons.ts`) |

## Privacy answers

These describe the app connected to **OpenValens Cloud**. When someone connects
the app to their own server, that server's operator collects the data, not us.
Both forms only ask about what we collect. The source is the data map in
`docs/legal/data-map.md` (#300). If either changes, update the other.

### Data the app sends to Cloud

| Data                                                                                                                                               | Required? | Purpose           | Linked to the person |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------- | -------------------- |
| Email address                                                                                                                                      | Yes       | Account, sign-in  | Yes                  |
| Name                                                                                                                                               | No        | Account           | Yes                  |
| User ID (account id; Google/Apple subject id when signing in with them)                                                                            | Yes       | Account           | Yes                  |
| Health records: labs, body, vitals, sleep, activity, workouts, nutrition, water, cycle, goals, clinical notes, preventive care with family history | No        | App functionality | Yes                  |
| Apple Health / Health Connect: steps, heart rate, sleep, weight, body fat, active energy, distance, workouts                                       | No        | App functionality | Yes                  |
| Progress photos (added on the web, shown in the app)                                                                                               | No        | App functionality | Yes                  |
| Notes and AI assistant conversations                                                                                                               | No        | App functionality | Yes                  |
| Push token                                                                                                                                         | No        | Notifications     | Yes                  |
| Crash reports (Sentry, scrubbed of health data, only if `EXPO_PUBLIC_SENTRY_DSN` is set in the store build)                                        | Yes       | App functionality | No                   |

Not collected: location, contacts, browsing or search history, advertising
identifiers, audio, purchases. Camera frames used for barcode scanning are not
kept. Analytics is off at launch. If it is turned on, add **Usage data ›
Product interaction (Analytics, not linked)** to both forms.

### Apple: App Store Connect › App Privacy

- **Do you or your third-party partners collect data from this app?** Yes.
- **Tracking:** No. Nothing is used for tracking or advertising.

| Apple category   | Data type          | Purpose           | Linked to user | Tracking |
| ---------------- | ------------------ | ----------------- | -------------- | -------- |
| Contact Info     | Email Address      | App Functionality | Yes            | No       |
| Contact Info     | Name               | App Functionality | Yes            | No       |
| Health & Fitness | Health             | App Functionality | Yes            | No       |
| Health & Fitness | Fitness            | App Functionality | Yes            | No       |
| User Content     | Photos or Videos   | App Functionality | Yes            | No       |
| User Content     | Other User Content | App Functionality | Yes            | No       |
| Identifiers      | User ID            | App Functionality | Yes            | No       |
| Diagnostics      | Crash Data         | App Functionality | No             | No       |

`[CONFIRM]` **Sensitive Info:** nutrition declarations include "pregnant or
breastfeeding", and preventive care keeps family history. Apple lists
pregnancy information and genetic information under Sensitive Info, so
declare **Sensitive Info (App Functionality, linked)** as well. Declaring too
much is safe; declaring too little is a rejection risk.

Apple does not list push tokens as a data type, so they are not declared.

### Google: Play Console › App content › Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS only).
- **Do you provide a way for users to request that their data is deleted?**
  Yes, in the app (Settings › Delete account and all data) and on the web
  (see owner decision 3).
- **Shared:** none. Hosting, email, error reporting, push delivery and the
  optional AI provider are service providers acting for us, which Google does
  not count as sharing. Nothing is sold.

| Google category          | Data type                        | Collected | Optional | Purpose            | Processed ephemerally |
| ------------------------ | -------------------------------- | --------- | -------- | ------------------ | --------------------- |
| Personal info            | Email address                    | Yes       | No       | Account management | No                    |
| Personal info            | Name                             | Yes       | Yes      | Account management | No                    |
| Personal info            | User IDs                         | Yes       | No       | Account management | No                    |
| Health and fitness       | Health info                      | Yes       | Yes      | App functionality  | No                    |
| Health and fitness       | Fitness info                     | Yes       | Yes      | App functionality  | No                    |
| Photos and videos        | Photos                           | Yes       | Yes      | App functionality  | No                    |
| App activity             | Other user-generated content     | Yes       | Yes      | App functionality  | No                    |
| App info and performance | Crash logs                       | Yes       | No       | App functionality  | No                    |
| Device or other IDs      | Device or other IDs (push token) | Yes       | Yes      | App functionality  | No                    |

### Google: Health Connect permissions declaration

Play Console › App content › Health apps asks why each permission is needed.
The app only reads, never writes.

| Permission                       | Justification                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `READ_STEPS`                     | Shows daily steps in the person's activity history.                                                           |
| `READ_HEART_RATE`                | Shows heart rate readings in the person's vitals history.                                                     |
| `READ_SLEEP`                     | Shows sleep sessions and stages in the person's sleep history.                                                |
| `READ_WEIGHT`                    | Adds weight measurements to the person's body record.                                                         |
| `READ_BODY_FAT`                  | Adds body fat measurements to the person's body record.                                                       |
| `READ_ACTIVE_CALORIES_BURNED`    | Shows active energy in the person's activity history.                                                         |
| `READ_DISTANCE`                  | Shows walking and running distance in the person's activity history.                                          |
| `READ_EXERCISE`                  | Imports workouts recorded by other apps into the person's workout log.                                        |
| `READ_HEALTH_DATA_IN_BACKGROUND` | Keeps the record up to date when the app is closed. The person turns sync on and can turn it off in Settings. |
| `READ_HEALTH_DATA_HISTORY`       | Imports data from before the app was installed, so the person's history is complete from the start.           |

Pick **Health and fitness** as the app category. The intended-purpose
statement in the description answers Play's question about medical
functionality: the app is not a medical device.
