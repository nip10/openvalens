# Score algorithms (Issue #95)

OpenValens shows two separate numbers on the **Scores** screen (web `/scores`,
native drawer → Scores). They are never blended into one health score.

| Number          | Version                        | Endpoint             | Permission     |
| --------------- | ------------------------------ | -------------------- | -------------- |
| Readiness index | `readiness-0.1.0-experimental` | `score.readiness`    | `records:read` |
| Goal progress   | `goal-progress-0.3.0`          | `score.goalProgress` | `goals:read`   |

Both are computed on the server on every request from the active workspace's
records (`packages/api/src/score.ts`), with pure, deterministic algorithms
(`score-readiness.ts`, `score-goal-progress.ts`). Wire contract:
`packages/api/src/score-contract.ts`. Shared copy and view models for web and
native: `packages/api/src/presenters/score.ts`.

**Status: experimental, unvalidated.** The reviewed research
(`docs/research/reports/Health onboarding and scoring evidence.md`,
`Personal goal aggregation evidence.md`) supplies no validated weights,
cutoffs, baseline lengths or confidence thresholds for a composite like this.
Every constant below is a documented product choice, not an evidence finding.
Changing any of them bumps the algorithm version. This document must be
reviewed before each algorithm release.

## What the numbers do not claim

They are not medical advice, say nothing about health status, and do not
predict anything or tell anyone whether or how hard to exercise. Copy is
checked against the health-copy rules (`presenters/score.test.ts`).

Scope is adults (18+, general wellness). When the signed-in person has
answered the #98 eligibility question with "under 18", both scores are
withheld (`adults_only`).

## Readiness index — `readiness-0.1.0-experimental`

### Inputs

| Input                | Source                                                               | Recent value                                                         | Baseline                                         | Points per 1.0 relative change |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| `sleep`              | `@openvalens/sleep` daily summaries, `asleepMinutes` (UTC wake date) | latest night dated today or yesterday                                | median of the 28 days before it, ≥ 7 with data   | +100                           |
| `resting_heart_rate` | `@openvalens/vitals` daily average resting heart rate                | latest day, today or yesterday                                       | median of the 28 days before it, ≥ 7 with data   | −300                           |
| `activity_load`      | `@openvalens/activity` daily steps                                   | mean of the last three complete days (today excluded), ≥ 2 with data | median of the 28 days before them, ≥ 7 with data | −50                            |
| `hrv`                | not stored by OpenValens yet                                         | —                                                                    | —                                                | not used                       |
| `check_in`           | not collected yet                                                    | —                                                                    | —                                                | not used                       |

A missing or non-positive day is unknown, never zero.

### Component and index

For each ready input: `relative = (recent − baseline) / baseline`, and
`component = clamp(50 + points × relative, 0, 100)`, rounded. 50 means "in
line with your usual". Examples: 10% less sleep → 40; resting heart rate 5%
above usual → 35; recent steps twice the usual → 0.

The index is the plain (equal-weight) mean of the components the active
profile uses, rounded. Equal weights were chosen because no evidence-based
weights exist.

### Scoring profiles

| Profile               | Required                      | Optional        |
| --------------------- | ----------------------------- | --------------- |
| `physiology_enhanced` | `sleep`, `resting_heart_rate` | `activity_load` |
| `manual_friendly`     | `sleep`, `activity_load`      | —               |

The first profile whose required inputs are all ready is used
(physiology-enhanced first). The active profile is always returned and shown;
scores from different profiles are not equivalent. If neither profile's
required inputs are ready the score is **withheld** (`insufficient_inputs`)
with no number, each input's state, and `wouldHelp` listing inputs that need
more data. A wearable is never required: the manual-friendly profile works
with manually entered sleep and steps.

### Input states

`used`, `ready_not_used` (ready, but not in the active profile),
`no_recent_value`, `insufficient_baseline`, `not_supported_yet`.

## Goal progress — `goal-progress-0.3.0`

### Goal measurement contract

`goal` gained three nullable columns (migration
`20261015192051_goal_measurement`): `direction` (`increase` | `decrease`),
`baseline_value` (starting value) and `priority` (`low` | `normal` | `high`).
The add-goal form on web and native asks for a starting value, target,
direction and priority; the starting value is stored as both baseline and first
current value. "Log" on a goal records a check-in, whose value becomes the
current value.

### Per-goal progress (`deriveGoalProgress` in `@openvalens/plans`)

- Direction: the stored direction, otherwise inferred from a baseline on one
  side of the target, otherwise unknown. **Without a direction there is no
  progress and no "achieved"** — fixes the bug where a 70 kg weight goal at
  80 kg read as achieved.
- Baseline: the stored baseline, otherwise the earliest numeric check-in when
  there are at least two. A baseline on the wrong side of the target is
  ignored.
- With a baseline: `(current − baseline) / (target − baseline)`, clamped to
  [0, 1]. Over-achievement caps at 100% (shown as "target reached").
- An `increase` goal without a baseline is measured from 0 and labelled so.
  A `decrease` goal without a baseline is unscored until it reaches its target.
- Trend: the change between the last two numeric check-ins, toward or away
  from the target. A goal moving away is **flagged** next to the total.

### Personal goals of every source (0.2.0 trackers, #451; 0.3.0 every source, #500)

The member's own personal goals count too, whatever their source: manual
check-ins, water (the plain-water diary), supplement intakes, workout sets,
sleep nights and custom trackers. 0.2.0 counted tracker goals only; 0.3.0
adds the other five sources. Only the member's own goals are read (the
personal-goal repository is owner-scoped), and a sleep goal's nights come
from the same evidence as the goals screen. The score counts a goal whatever
the member's module choice (goals are always on). Goal insights do follow the
source's module: a water goal names no insight while Food & water is hidden
(see `docs/insight-rules.md`).

The goal's own evaluation of its days gives a current value and a target,
under the rule in force on the evaluation date (an edited goal is measured
against its newest rule, not its first one). Then the same per-goal progress
applies (measured from 0, priority normal):

- One-time target and rolling average: the latest day (or the complete
  window's average; an incomplete window is `needs_current_value`) against the
  threshold, up for "at least", down for "at most".
- Streak: the current streak against the streak length.
- Weekly schedule: the last full Monday–Sunday week's qualifying days against
  the days required. Daily and weekday schedules: the qualifying days among
  the last seven scheduled days; today counts once it has an entry.
- A goal that reached its target, or that the member marked complete, is 100%.
  Paused goals are left out. There is no trend, so personal goals are never
  flagged.

| Source     | A day's value                                          | Example                                        |
| ---------- | ------------------------------------------------------ | ---------------------------------------------- |
| manual     | the day's latest check-in (a value, or done/not done)  | streak of days stretched                       |
| water      | plain-water entries summed, in ml                      | 7-day average of at least 2000 ml              |
| supplement | one credit for a day with an intake of that supplement | taken every day: qualifying days of the last 7 |
| workout    | the day's heaviest set of that exercise, in kg         | squat 100 kg once: reached is 100%             |
| sleep      | the night's sleep by wake date, in hours               | at least 7 h every night                       |
| tracker    | the tracker's own daily combination (#451)             | sauna minutes per day                          |

### Goal states

`scored`, `paused`, `not_applicable` (cancelled), `needs_target`,
`needs_current_value`, `needs_direction`, `needs_baseline`. Only `scored` goals
enter the total; the others are excluded from the denominator, never counted as
zero. A wellness-profile focus area alone produces no number.

### Total

`score = round(100 × Σ wᵢ·pᵢ / Σ wᵢ)` over scored goals, with priority weights
low 1, normal 2, high 3 (unset counts as normal). Each goal's own progress,
weight share (`contribution`) and flag are returned beside the total. With no
scored goals the total is withheld (`no_goals` / `no_measurable_goals`).

## Storage, versioning and privacy

- Scores are **not stored or cached**: each request recomputes from current
  records, so there is no history to splice and nothing extra to export or
  delete. Goal measurement fields live on `goal`, already covered by data-rights
  export/delete.
- Every result carries its algorithm version.
- Reads are scoped to the active organization from the trusted authz context;
  inputs are empty strict objects. Logs carry only outcome state, profile and
  counts — never a score or input value.

## Known limitations and follow-ups

- No stored score history yet, so there are no annotated version boundaries
  when goals, priorities, devices or profiles change.
- HRV and a subjective check-in are listed but not recorded yet.
- Sleep days use the UTC wake date (as `@openvalens/sleep` does).
- No comprehension testing or stability evaluation has been done; this is
  required before the readiness index loses its experimental label.
