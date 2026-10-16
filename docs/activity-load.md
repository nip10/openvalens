# Weekly activity and activity load (Issue #99)

OpenValens shows two separate, named numbers for the last 7 days on the
**Workouts** screen (web `/workouts`, native drawer → Workouts). They are never
blended into one "strain" score, and neither is a copy of, or equivalent to,
any proprietary score (no PAI, no WHOOP Strain, no 0–21 scale).

| Number         | Unit    | Formula                                  | Who sees it                     |
| -------------- | ------- | ---------------------------------------- | ------------------------------- |
| Active minutes | minutes | moderate minutes + 2 × vigorous minutes  | everyone with sessions          |
| Effort points  | points  | Σ effort rating (0–10) × session minutes | everyone who rates their effort |

Algorithm version: **`activity-load-0.1.0`**. Endpoint: `activity.weeklyLoad`
(needs `workout:read` and `records:read`). Pure calculation:
`packages/activity/src/load.ts` (`computeWeeklyActivityLoad`); session reader:
`packages/activity/src/sessions.ts`; service: `packages/api/src/activity-load.ts`;
wire contract: `packages/api/src/activity-load-contract.ts`; shared web/native
copy and view model: `packages/api/src/presenters/activity-load.ts`.

Every call recomputes from the workspace's current records. Nothing is stored
or cached, so export and deletion of the underlying `workout` and
`health_event` rows (#89 data rights) cover everything.

## What the numbers do not claim

They describe what was recorded. They are not medical advice, make no claim
about anyone's health, do not predict anything, and do not tell anyone whether
or how hard to train. There are no injury, overtraining or recovery messages,
no ratio "zones", no monotony score, and no comparison with other people
(#96 owns population comparisons). Copy is checked against the #99 wording
rules in `presenters/activity-load.test.ts`.

Scope is adults (18+, general wellness). When the signed-in person answered the
#98 eligibility question with "under 18", the whole view is withheld
(`adults_only`), matching the #95 scores.

## Window

"This week" is the **last 7 calendar days including today** (UTC dates, the
same convention as the other daily views), not the calendar week, so a Monday
never compares a one-day week with full weeks. Earlier windows are the 7-day
blocks before it, without overlap.

## Active minutes (WHO)

- Source: manual sessions (`workout`) with a self-reported intensity and a
  duration. Intensity method: **self-reported talk test** — light ("you can
  talk and sing"), moderate ("you can talk, but not sing"), vigorous ("you can
  only say a few words without pausing for breath").
- `active = moderate + 2 × vigorous`. Light minutes are recorded and shown but
  not counted.
- Shown against the **WHO 2020 adult range of 150–300 minutes a week** of
  moderate activity (or 75–150 vigorous, or an equivalent mix, where vigorous
  minutes count double): Bull FC, et al. _World Health Organization 2020
  guidelines on physical activity and sedentary behaviour._ Br J Sports Med.
  2020;54:1451–1462. [doi:10.1136/bjsports-2020-102955](https://doi.org/10.1136/bjsports-2020-102955).
  Position text: below / within (inclusive) / above the range.
- The guideline is derived from observational dose-response studies; the app
  says only that more weekly activity was _associated_ with lower mortality in
  large observational studies and that the range is a population guideline,
  not a personal target. No "years gained" or risk-reduction numbers.
- Coverage: sessions with and without an intensity, minutes without an
  intensity (not counted), sessions without a duration.
- Unavailable states: `no_sessions` (nothing recorded in the window — shown as
  "—", never 0) and `no_intensity` (sessions exist, none with an intensity and
  a duration).
- **Wearable workouts** (`health_event` of type `workout`, not superseded) are
  read with their duration, but OpenValens has no intensity for them yet, so
  their minutes are listed as "without an intensity" and not counted.
  HR-derived intensity needs agreed cut-points (open question on #99).

## Effort points (session-RPE)

- Each session's **effort rating** (0–10, CR-10 anchors: 0 rest, 1 very, very
  easy, 2 easy, 3 moderate, 4 somewhat hard, 5 hard, 7 very hard, 10 maximal)
  × its minutes: Foster C, et al. _A new approach to monitoring exercise
  training._ J Strength Cond Res. 2001;15(1):109–115.
- Summed per day (7 rows) and over the window. A day with no rated session is
  "—" (or "not rated" when it has unrated sessions), never 0.
- The rating is captured on session save, or added later via
  `plans.workouts.rateEffort`. The server accepts a rating while the session's
  date is within one day of the current UTC date (so "the same day" holds in
  any time zone, UTC−12 to UTC+14); after that it returns `CONFLICT`. The apps
  offer "Rate" on the session's own day. `effort_rated_at` records when the
  latest rating was given. Missing ratings are never estimated.
- Coverage: rated / unrated sessions, rated sessions without a duration.
- Unavailable states: `no_sessions`, `no_ratings`.
- Limits: session-RPE has been studied mostly in athletes and recreational
  exercisers; it tracks with heart-rate based load measures but has no
  validation against wellness outcomes, and novices' ratings are less
  consistent at first.

## Comparison with your own earlier weeks

Descriptive only, effort points only.

- **Baseline:** the average effort points of the previous **4** windows that
  have at least one rated session with a duration. The current window is never
  part of it. Unlogged windows are missing, not zero.
- **Threshold:** shown only when at least **3** of those 4 windows are logged
  (`insufficient_history` otherwise).
- **Segmenting:** each window's _sources_ are the set of sources of its rated
  sessions (`manual`, or `device:<data source id>`). Walking back from the most
  recent earlier window, history stops at the first logged window whose
  sources differ from the current window's. If that leaves fewer than 3
  windows the comparison is withheld as `history_segmented`.
- **Bands:** ratio = current ÷ baseline. `well_above` at ≥ 1.5, `well_below` at
  ≤ 1 ÷ 1.5, otherwise `similar`. A baseline of only 0-rated sessions (average 0) gives `similar` for a 0 week and `well_above` otherwise.
- Copy: "This week's effort points are well above / similar to / well below
  your average for the previous weeks", with both numbers, the number of
  weeks used, and "this week not included".
- No acute:chronic ratios, no "sweet spot" or "danger" zones, no injury or
  overtraining framing.

The 7-day window, the 4-window baseline, the 3-window threshold and the 1.5×
band are **product choices**, not evidence-derived. Changing any of them bumps
the algorithm version. They should be calibrated alongside #92's false-alarm
budget.

## Context (not converted into points)

- **Steps:** total over days with step data in the window, and the number of
  such days (`@openvalens/activity` daily totals).
- **Strength volume:** Σ reps × kg over weighted sets of the window's manual
  sessions, and the number of sessions with weighted sets.

## Not in this version

- **Heart-rate load** (Edwards TRIMP): not calculated. It needs valid resting
  and maximum heart rate per person and an optional "my heart rate doesn't
  reflect effort" flag in the wellness profile; whether to ship it in v1 is an
  open product question on #99. The app says so in the card.
- HR-derived intensity for wearable workouts (needs cut-points; see above).

## Contract for downstream consumers (#95, #92)

`activity.weeklyLoad` returns `ActivityLoadResult`
(`packages/api/src/activity-load-contract.ts`):

- `status` / `withheldReason` (`adults_only`), and `load` (null when withheld).
- `load.algorithmVersion` — consumers must check it before relying on a field.
- `load.activeMinutes` — `status`, `activeMinutes`, `moderateMinutes`,
  `vigorousMinutes`, `lightMinutes`, `whoRange`, `whoPosition`, `coverage`.
- `load.effort` — `status`, `points`, `days[]` (`date`, `points`,
  `ratedSessions`, `unratedSessions`), `coverage`.
- `load.comparison` — `status`, `band`, `currentPoints`, `baselineAverage`,
  `relativeDifference`, `baselineWindows`, `baselineWindowsConsidered`,
  `baselineMinWindows`, `segmentedBefore`.
- `load.context` — `steps`, `stepDays`, `strengthVolumeKg`, `strengthSessions`.

Server-side consumers can call `computeWeeklyActivityLoad` directly with
`listActivitySessions` output. The readiness index (`readiness-0.1.0-experimental`)
still uses daily steps for its `activity_load` input; switching it to effort
points would be a new readiness version and is left to #95 follow-up work.

## Data

Migration `20261016090000_workout_session_effort` adds three nullable columns to
`workout`: `intensity` (`light` | `moderate` | `vigorous`), `effort_rating`
(0–10) and `effort_rated_at`, plus an `(organization_id, date)` index. Existing
rows read as "not recorded". Logs carry statuses only — never minutes, points
or ratings; the `rateEffort` audit row records that the rating changed, not
its value.
