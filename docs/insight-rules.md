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

Engine version: `insights-0.1.0`. Each rule carries its own version
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

| Rule id                      | Kind           | Parameters                                                                                                                                                                 | Window key (dedupe)                |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `change.sleep_duration`      | change         | Minutes asleep per wake date. Floor 30 min. Window ends today.                                                                                                             | ISO week of the window end         |
| `change.resting_heart_rate`  | change         | Daily mean resting heart rate. Floor 3 bpm. Window ends today.                                                                                                             | ISO week                           |
| `change.steps`               | change         | Daily steps from the dominant source. Floor max(1,000 steps, 20% of the baseline). Window ends yesterday (today is partial).                                               | ISO week                           |
| `change.weight_trend`        | change         | Least-squares trend of canonical daily weight over 28 days; ≥ 8 weigh-ins spanning ≥ 21 days; fitted change ≥ max(0.5 kg, 1.5% of the mean) and slope ≥ 3 standard errors. | ISO week                           |
| `goal.reached`               | goal_milestone | A counted goal (#95) whose latest value reached its target.                                                                                                                | goal id                            |
| `goal.toward_target`         | goal_milestone | The latest check-in (within 14 days) moved toward the target.                                                                                                              | goal id + check-in date            |
| `goal.away_from_target`      | goal_milestone | The latest check-in (within 14 days) moved away from the target.                                                                                                           | goal id + check-in date            |
| `data_quality.recording_gap` | data_quality   | Sleep, resting heart rate or steps had ≥ 10 days with data in the 28 before the gap and nothing for 3–30 days.                                                             | measure + last recorded date       |
| `data_quality.source_change` | data_quality   | A change rule is rebuilding its baseline after a new device or app.                                                                                                        | measure + first date of the source |
| `streak.recording`           | streak         | Consecutive days with sleep, steps or weight ending today or yesterday; milestones 7, 14, 30, 60, 90 days. `computeRecordingStreak` is the shared contract for #90.        | measure + streak start + milestone |

Weight comes from the canonical daily weight, which carries no device id, so
weight baselines are not segmented by source. Nutrition insights belong to #86;
labs and HRV rules are not part of v1.

## Budget, dismissal and mutes

- **Change cap:** at most 2 change insights are shown at once (4 in the weekly
  email); the rest are counted as held back.
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
