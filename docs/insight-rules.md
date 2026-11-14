# Insight rules

Insights (Issue #92) are short, deterministic descriptions of what changed in a
person's own records: what changed, compared with what, how sure the rule is,
how much data it used, and which other measures changed at the same time. They
are produced by the versioned rules in `packages/api/src/insight-rules.ts` and
rendered from the reviewed templates in `packages/api/src/presenters/insights.ts`.
There is no AI in the path; with AI consent the app only offers an optional
"Ask the coach about this" link.

Insights are **not stored**. Every request recomputes them from the workspace's
current records. What is stored is the person's feedback, delivery preferences,
registered phones and delivery history, none of which holds a health value.

Scope: adults 18 and over, general wellness (#98). A declared under-18 gets no
insights. Insights never advise, diagnose, predict risk or describe a cause. A
copy lint (`presenters/insights.test.ts`) renders every template and fails on
advice, diagnostic, risk, judging and causal wording.

Engine version: `insights-0.3.0` (`INSIGHT_ENGINE_VERSION`; 0.3.0 added the
custom-tracker rule, #450). Each rule carries its own version
(`INSIGHT_RULE_VERSIONS`); changing a parameter or template bumps it.

## Evidence and limits

The parameters below come from published within-person variability
(`docs/research/reports/Insight change detection and delivery.md`): resting
heart rate varies by about 3 bpm a day within a person (Quer et al. 2020), sleep
duration by 60–80 minutes, steps by 35–60%, and weight by 0.5–0.7% with a weekly
cycle (Turicchi et al. 2020). Comparing a change against a person's own noise
and a practical minimum follows Buchheit (2014) and the Reliable Change Index
idea (Jacobson & Truax 1991); k-of-n persistence follows Quer et al.

**None of these are validated cutoffs.** No study validates a specific insight
rule or false-alarm budget for general adults on consumer devices. They are
documented, configurable product choices to be calibrated, and copy therefore
says "different from your usual", never "meaningful for your health".

## Shared gates (change rules)

| Gate             | Rule                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness        | At least 14 days with data in the 28-day baseline and 5 of the last 7 days. Otherwise the rule reports `building_baseline` or `no_recent_data` ("not enough data yet") and stays silent — never zero, never "no change".                                                                                               |
| Noise and floor  | The 7-day mean must differ from the baseline median by at least `max(floor, k × SD × √(1/n_recent + 1/n_baseline))`, with the person's own baseline SD and k = 3.5.                                                                                                                                                    |
| Persistence      | At least 4 recent days must sit past the baseline median by half that threshold, so one extreme day cannot carry the mean.                                                                                                                                                                                             |
| Sustained        | The same comparison must also hold for the window ending the day before (2 consecutive days).                                                                                                                                                                                                                          |
| Weekday handling | The recent window is 7 consecutive days and the baseline 28 days (four whole weeks), so every weekday appears in both.                                                                                                                                                                                                 |
| Same source      | Each day uses its dominant data source (most samples). Baselines use only the current source (the source of the latest day); other sources are never spliced in. When the current source has too few baseline days the rule reports `rebuilding_after_source_change`. Unknown-source days count as the current source. |
| Certainty        | "clearly larger" when the difference is at least 1.5 × the threshold with 6–7 recent days; otherwise "only a little larger".                                                                                                                                                                                           |
| Co-occurrence    | Up to 2 other measures whose difference reached half their own threshold in the same window are listed, worded as "changed at the same time; that does not mean one explains the other".                                                                                                                               |

## Rules

| Rule id                      | Kind           | Parameters                                                                                                                                                                                                                  | Window key (dedupe)                |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `change.sleep_duration`      | change         | Minutes asleep per wake date. Floor 30 min. Window ends today.                                                                                                                                                              | ISO week of the window end         |
| `change.resting_heart_rate`  | change         | Daily mean resting heart rate. Floor 3 bpm. Window ends today.                                                                                                                                                              | ISO week                           |
| `change.steps`               | change         | Daily steps from the dominant source. Floor max(1,000 steps, 20% of the baseline). Window ends yesterday (today is partial).                                                                                                | ISO week                           |
| `change.weight_trend`        | change         | Least-squares trend of canonical daily weight over 28 days; ≥ 8 weigh-ins spanning ≥ 21 days; fitted change ≥ max(0.5 kg, 1.5% of the mean) and slope ≥ 3 standard errors.                                                  | ISO week                           |
| `change.tracker`             | change         | One of your own custom trackers (number, duration or yes/no; never a 1–5 scale) with the insights/AI switch on. The shared gates with a relative floor; window ends yesterday. See [Custom trackers](#custom-trackers-450). | tracker id + ISO week              |
| `goal.reached`               | goal_milestone | A counted goal (#95) whose latest value reached its target.                                                                                                                                                                 | goal id                            |
| `goal.toward_target`         | goal_milestone | The latest check-in (within 14 days) moved toward the target.                                                                                                                                                               | goal id + check-in date            |
| `goal.away_from_target`      | goal_milestone | The latest check-in (within 14 days) moved away from the target.                                                                                                                                                            | goal id + check-in date            |
| `data_quality.recording_gap` | data_quality   | Sleep, resting heart rate or steps had ≥ 10 days with data in the 28 before the gap and nothing for 3–30 days.                                                                                                              | measure + last recorded date       |
| `data_quality.source_change` | data_quality   | A change rule is rebuilding its baseline after a new device or app.                                                                                                                                                         | measure + first date of the source |
| `streak.recording`           | streak         | Consecutive days with sleep, steps or weight ending today or yesterday; milestones 7, 14, 30, 60, 90 days. `computeRecordingStreak` is the shared contract for #90.                                                         | measure + streak start + milestone |

Weight comes from the canonical daily weight, which carries no device id, so
weight baselines are not segmented by source. Nutrition insights belong to #86;
labs and HRV rules are not part of v1.

## Custom trackers (#450)

`change.tracker` describes a change in one of the member's own custom trackers
(#441), e.g. "Sauna: higher than your usual". It uses the shared gates above
(the last 7 days against the 28 before, at least 14 baseline days and 5 of the
last 7, k = 3.5, 4 days of persistence, 2-day confirmation, same certainty
wording). A day's value is the tracker's own day aggregation (number: sum,
average or last; duration: sum; yes/no: yes if any entry says yes).

**Which trackers.** Only the viewer's own trackers, not archived, with "Coach
and connected AI apps can read this" on (the tracker editor says that insights
use it too). Another member's shared tracker is never read. 1–5 scales (mood,
energy, stress) are left out entirely, so nothing reads like screening. There
is no good or bad direction, even when the tracker has a goal or target:
the copy only says higher, lower, more or fewer yes days than your usual.

**Noise floor for user-defined units.** The built-in rules use absolute floors
in known units. A tracker's unit is the member's own, so the floor is relative:

`threshold = max(k × SD × √(1/n_recent + 1/n_baseline), 20% × |baseline median|, step)`

where `step` is the smallest difference worth naming in the tracker's terms:
one display step for numbers (1 at 0 decimals, 0.1 at 1, 0.01 at 2), one
minute for durations, and one yes day a week for yes/no. The step only matters
when the usual is zero or tiny; otherwise the 20% (as for steps) or the
person's own variation decides.

**Number and duration series.** Logged days only, so the 14 and 5-of-7 gates
count days with an entry. Zero and negative numbers are values, not gaps.
Durations are stored and compared in seconds and shown as durations
("25 min"). A tracker logged on only a few days a week (sauna twice a week)
stays silent: it never reaches the 5-of-7 gate.

**Yes/no series.** Many yes/no trackers are logged only on yes days, so the
series is 1 for a yes day and 0 for every other day (an explicit "no" or no
entry), from the first logged day to the window end. The gates then count days
since the first entry. The median of a yes/no day is always just yes or no, so
the usual is the baseline's **share** of yes days (its mean) instead of its
median; the copy shows it as yes days a week ("yes on 6 of the last 7 days,
compared with your usual of about 2.5 days a week"), and says that a day with
no entry counts as no. At least one day of the recent window must have an
entry, so a tracker the member stopped using stays silent rather than reading
as "fewer yes days".

**Other differences from the built-in rules.**

- The window ends yesterday for every tracker: today's total is partial.
- No readiness rows: a tracker stays silent until it has enough data.
- No source segmentation (entries are mostly manual) and no co-occurring
  factors either way: a tracker change lists none, and is never listed as a
  factor of a built-in change.
- Topic `trackers`: a push that may name its topic says only "You have a new
  tracker insight", never the tracker's name.
- No module: tracker insights are not hidden by the module switches.
- "Not useful" mutes the whole rule, so every tracker's change insights, for
  30 days, like any other rule; dismissing hides one tracker's insight for
  that week.

**False alarms.** `insight-rules-trackers.test.ts` simulates 40 people with
three stable trackers each (a noisy count with unlogged days, a duration and a
yes/no with a steady share logged only on yes days) and requires at most one
change insight per tracker per 300 days. The current parameters give about one
per 1,900 days.

## Nutrition timing observations (#84)

These optional in-app observations compare meal timestamps from completed
diary days with recorded sleep starts or workouts in a selected period. Sleep
and workouts count only when their canonical source event has a finite start
and an explicit valid `payloadJson.endAt` later than the start; workouts also
require a non-empty canonical `payloadJson.activity`. Missing, malformed or
reversed intervals are omitted rather than inferred. A seven-day minimum and
three matching records gate display; they are product sparsity safeguards, not
validated thresholds. They describe timestamped records only, not complete
coverage of the period, causes, health effects, or energy expenditure. Overall
source coverage is unknown. The feature is opt-in and respects module
permissions and hide-numbers settings.

## Budget, dismissal and mutes

- **Change cap:** at most 2 change insights are shown at once (4 in the weekly
  email); the rest are counted as held back. Tracker changes (#450) share the
  cap with the built-in measures, in the same strongest-first order, but fill
  at most half of it (1 in the app, 2 in the email), so someone with many
  trackers still sees a sleep, heart-rate, steps or weight change. Tracker
  changes over their share are counted as held back too.
- **False-alarm budget:** `insight-rules.test.ts` simulates 60 people with
  stable but noisy, autocorrelated data (with weekday cycles and missing days)
  for 110 evaluated days and requires at most one change insight per person per
  30 days across all change rules. The current parameters give about 0.45.
- **Dismiss** hides one insight (rule + window). **Not useful** also hides the
  rule for that person for 30 days. Feedback is per person and never used for
  analytics.

## Delivery

Push and email are optional extra channels for the same insights
(`packages/api/src/insight-delivery.ts`, cron `cron.insightsRun`, hourly):

- Off until the person turns them on; only the workspace owner can, and the
  email digest needs an explicit acknowledgement that it contains values and
  that email is not private.
- The push offer appears in context, only after an insight is on screen, never
  at first launch, and never again once answered.
- At most one push per local day and one email per ISO week, never before the
  person's chosen local hour. Each send is claimed in `insight_delivery`
  (organization, user, channel, period), so runs are idempotent.
- An insight id already delivered on a channel is not sent on it again.
- Push text is generic ("You have a new insight", or the topic if the person
  allowed it), sent quietly (iOS passive, Android low-importance `insights`
  channel). No value ever appears in a push payload or on a lock screen.
- The weekly email is a service message with the insights and their values, a
  link to the app and a one-step unsubscribe link (also as `List-Unsubscribe`).
- Delivery rows hold channel, period, insight ids and `<rule>@<version>`; logs
  hold ids, counts and typed error categories only.
- #97 preventive-care reminders use the same channels, claim and limits
  (kind `reminder`, ids `reminder:<item>:<date>`, generic text). See
  [`preventive-care.md`](preventive-care.md#reminders).
