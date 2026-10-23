# Translations (#67)

OpenValens ships in English and European Portuguese (pt-PT). The web and
mobile apps share one set of catalogs in `packages/i18n`. Lingui runs the
pipeline: macros in code, `.po` catalogs for translators, and compiled
TypeScript catalogs committed next to them.

## For developers: marking text for translation

Wrap user-facing text in a Lingui macro. Both apps support:

```tsx
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";

<Trans>Interface language</Trans>; // JSX text
const { t } = useLingui();
t`Language`; // strings in components
const LABEL = msg`Meal diary`;
i18n._(LABEL); // constants defined outside components
```

Mark text as safety-critical with a `safety` comment. This covers units,
reference-range flags, medication and dosing labels, and consent text:

```tsx
t({ message: "Take with food", comment: "safety" })
<Trans comment="safety">I agree to …</Trans>
```

A safety string in an unreviewed locale renders in English until a reviewer
approves it.

Never translate analyte codes, units, medication names or user-entered text.
Don't build sentences by joining fragments: give translators the whole
sentence with placeholders, and use ICU plurals for counts
(`{count, plural, one {# food} other {# foods}}`).

After changing text:

```bash
bun run i18n:extract   # update .po catalogs and the safety id list
bun run i18n:compile   # write the TypeScript catalogs (fails if a shipped locale is missing a string)
```

Commit the `.po` and `.ts` changes. CI runs `bun run i18n:check`, which fails
in four cases:

- the catalogs are stale;
- a message has invalid ICU syntax;
- a shipped locale is missing a translation;
- the safety id list is out of date.

Every pull request that adds or changes text needs a pt-PT translation. A
best-effort translation is fine; reviewers correct it later.

## Choosing a language

- **Web:** the saved choice (Settings → Language, kept in the browser), else
  the browser's languages.
- **Mobile:** the saved choice (kept on the device), else the device
  language.

Any Portuguese variant maps to pt-PT. Everything else falls back to English.
Switching applies immediately, with no reload or restart.

The mobile app loads `@formatjs` Intl polyfills before anything else, because
Hermes lacks `Intl.PluralRules` and `Intl.Locale`.
`apps/native/lib/i18n/polyfills.test.ts` checks pt-PT and Polish plural
selection with the native Intl removed.

## Language, formats and lab units are separate

Settings → Language holds three independent choices:

- **Interface language:** which words the app uses.
- **Date and number format:** how dates and numbers look. "App default"
  follows the installation setting an administrator chose (United States,
  United Kingdom, Canada or Portugal). Picking one here overrides it on this
  device only.
- **Lab concentration units:** "As reported by the lab", mg/dL, or mmol/L
  (µmol/L for creatinine). This changes only how glucose, cholesterol,
  triglycerides and creatinine are displayed
  (`presenters/clinical-units.ts`). A stored result and its reported unit
  never change. Any other analyte, or a unit outside the pair, is shown
  exactly as reported.

Language does not imply a format or a unit. A member can read the app in
English with Portuguese dates and mmol/L results.

## Review states

`packages/i18n/src/review-state.json` records each locale's state:

- `"community"`: strings are shown, and settings marks the language as a
  community translation. Safety-tagged strings stay English except the ids
  listed in `approvedSafetyIds`.
- `"reviewed"`: every string is shown as translated.

A message missing from a translation always renders in English.

pt-PT is `reviewed` (approved by the project owner on 2026-10-23), so all
its strings show in Portuguese, safety-tagged ones included.

## Contributing a translation

Translations come in as ordinary pull requests that edit the `.po` files
under `packages/i18n/src/locales/`. They need DCO sign-off like any other
change (see CONTRIBUTING, Licensing and sign-off). There is no hosted
translation platform for now.

### Adding a language

1. Add the code to `LOCALES` and `LOCALE_NAMES` in
   `packages/i18n/src/locales.ts`, to `locales` in `lingui.config.ts`, and to
   `review-state.json` as `community`.
2. Run `bun run i18n:extract`, translate the new `messages.po`, then run
   `bun run i18n:compile`. Until every string is translated, `--strict`
   compilation fails. Catalogs compile at build time, so the language ships
   with the next release.

### Reviewing

A reviewer who reads the language fluently checks the catalog. To release
individual safety strings early, add their ids to that locale's
`approvedSafetyIds`; the ids are in `packages/i18n/src/safety-ids.ts`, which
`bun scripts/i18n-safety-ids.ts` generates. Once the whole locale is
reviewed, set its `status` to `reviewed`.
