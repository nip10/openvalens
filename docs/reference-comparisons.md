# Reference comparisons (Issue #96)

The **Scores** screen (web `/scores`, native drawer → Scores) has a
"Compared with published references" section below the readiness index and
goal progress. It answers "how do I compare with people like me?" only where a
published reference exists, and says plainly when it does not.

| Endpoint                    | Permission / scope                       |
| --------------------------- | ---------------------------------------- |
| `comparison.get`            | `records:read` on the active workspace   |
| `comparison.settings`       | signed-in person only (not impersonated) |
| `comparison.updateSettings` | signed-in person only (not impersonated) |

Code: reference data `packages/api/src/reference-data.ts` (version
`reference-data-2026-10-16`), pure calculation
`reference-comparison-compute.ts`, loader `reference-comparison.ts`, wire
contract `reference-comparison-contract.ts`, shared copy and view models
`presenters/reference-comparison.ts` (web card
`apps/web/src/components/reference-comparisons-card.tsx`, native
`apps/native/components/reference-comparisons-section.tsx`).

## Principles

- **Your own trend first.** Each metric always shows your latest value and
  your usual (the median of the days with data in the last 28 days), whether
  or not a comparison is on.
- **Opt-in per metric.** Every comparison is off until you turn it on; the
  toggle shows what it compares, its source and its limits first. The opt-in
  is stored per person in `reference_comparison_opt_in` (user-owned, with the
  reference-data version shown), exported and erased with your data (#89).
- **Two kinds of comparison only.** A guideline range (a published
  recommendation), or a coarse band for your age group and sex: below, within
  or above the middle half of a published reference group, worded as a natural
  frequency ("about 5 in 10 people in that group…").
- **No ranks, percentiles, "top N%", comparisons with other age groups,
  "heart age"/"fitness age", or community aggregate.** Nothing is computed
  from any other OpenValens user; the only population data are the static
  tables that ship with the app. `presenters/reference-comparison.test.ts`
  scans all copy for banned wording.
- **Nothing is inferred.** Age and sex come only from the wellness profile
  (#98) with their purpose consents. A band needs your whole age range (from
  your birth year) to fit inside one reference age row; otherwise it is
  unavailable with the reason. A guideline with age rows shows every row when
  your age is unavailable, and never picks one for you.
- **Coarse, not precise.** The compared value is your 28-day usual, rounded
  to a whole unit; only three bands exist; a value within 2 bpm of a band edge
  carries a "close to the edge" note.
- **Adults only, own workspace only.** A declared under-18 gets nothing; a
  missing adult answer makes every comparison unavailable. Bands use the
  viewer's age and sex, so they are shown only to the workspace owner (whose
  record it is); a viewer of a shared workspace sees the trend only.
- **No values in logs.** Logs carry metric names, statuses and reasons only.

## Metrics

| Metric             | Comparison                                    | Needs                                             | Comparability                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resting heart rate | Coarse band, NCHS NHSR 41 (by age group, sex) | Opt-in, adult, birth year + sex consents, ≥7 days | Manual entries: protocol note (seated, ~4 min rest). Any device day: "measured differently, likely reads lower" note. US 1999–2008 population note. No guideline range (the 60/100 bpm clinical thresholds are diagnostic thresholds and are not used). |
| Sleep duration     | Guideline range, NSF 2015 (age rows)          | Opt-in, adult, ≥7 nights; birth year for your row | A recommendation, not a distribution (noted).                                                                                                                                                                                                           |
| Active minutes     | Guideline range, WHO 2020 (all adults)        | Opt-in, adult, sessions with intensity            | Only sessions with a recorded intensity count (#99).                                                                                                                                                                                                    |

Never compared with other people (listed on screen with the reason): steps
(published tables are hip-worn; wrist and phone counts are not comparable —
active minutes are shown against WHO instead), weight/BMI/body fat/waist,
heart rate variability, VO₂max and grip strength (not recorded yet).

## Shipped reference data

Every dataset records source citation, URL, publisher, year, population,
collection years, method, licence and the date the values were checked;
`reference-data.test.ts` fails the build if any is missing, and spot-checks
the transcribed values.

| Id                           | Source                                                                                                                                                                   | Population / years                                | Method                                                                                             | Licence                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `nchs-nhsr41-resting-pulse`  | Ostchega Y, et al. _Resting pulse rate reference data…: United States, 1999–2008._ NHSR No. 41, NCHS, 2011, Tables 2–3. <https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf> | US adults (NHANES normative sample), 1999–2008    | Radial pulse, 30 s × 2, seated after ~4 min rest; 25th/50th/75th values, age 20–39/40–59/60–79/80+ | US government work, public domain            |
| `nsf-2015-sleep-duration`    | Hirshkowitz M, et al. _Sleep Health_ 2015;1(1):40–43. <https://doi.org/10.1016/j.sleh.2014.12.010>                                                                       | Adults 18–64 (7–9 h) and 65+ (7–8 h); issued 2015 | Expert panel, RAND/UCLA Appropriateness Method                                                     | Recommendation figures quoted as facts       |
| `who-2020-physical-activity` | Bull FC, et al. _Br J Sports Med_ 2020;54:1451–1462. <https://doi.org/10.1136/bjsports-2020-102955>                                                                      | Adults 18+ incl. 65+; issued 2020                 | Guideline development group; vigorous minutes count double                                         | Two figures quoted as facts with attribution |

Values were checked on 2026-10-16: NHSR 41 against the CDC PDF (Tables 2 and
3), the NSF age rows against the abstract (7–9 h adults, 7–8 h older adults)
and the National Sleep Foundation's own summary (18–64 / 65+), WHO against the
existing activity-load contract (#99, `docs/activity-load.md`).

## Needs human verification / decision

- **Licence review** of quoting the WHO and NSF figures (facts with
  attribution, no text or tables reproduced) — a maintainer should confirm.
- **NHSR 41 transcription**: values were extracted from the PDF text layer and
  spot-checked in tests; a second person should compare all 8 rows with
  Tables 2 and 3.
- **Not shipped**, each needing a licence and/or verification decision before
  it can become a dataset (see `REFERENCES_NOT_SHIPPED`): Tudor-Locke 2009
  steps (hip-worn, copyrighted), FRIEND 2022 VO₂max (copyrighted, link only),
  Dodds 2014 / Wang 2018 grip strength (licence unconfirmed), Nunan 2010 HRV
  (not an age × sex table).
- **Non-US populations**: no redistributable European resting-pulse table was
  found; UK/Portugal users see the US-population note.

## Out of scope / follow-ups

- Self-hosters swapping reference tables via configuration (the data shape and
  metadata test are ready; no config loader yet).
- A global "hide body metrics and comparisons" setting across all screens.
- Grip strength and VO₂max inputs (no metric exists yet).
