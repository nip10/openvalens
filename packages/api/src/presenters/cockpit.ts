/**
 * Cockpit presentation shared by web and mobile — composes today's snapshot
 * from the body, sleep, activity and vitals read paths. No imports: safe for
 * the app bundle. Copy follows docs/mobile/tone-of-voice.md.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { formatKg } from "./body";
import { formatSleepDuration, sleepStatusLabel, type SleepDailyLike } from "./sleep";
import { formatSteps, formatKcalories, formatDistanceMeters } from "./activity";
import { formatBpm } from "./vitals";

/**
 * Sleep window the cockpit requests from `sleep.summary` (Issue #134). It is
 * the smallest window the procedure accepts (`days` in `[7, 365]`). The
 * cockpit shows only `lastNight` — the most recent night in this window —
 * labelled with that night's own date, so the label never claims a wider or
 * fresher window than the data covers.
 */
export const COCKPIT_SLEEP_WINDOW_DAYS = 7;

export type CockpitWeight = { date: string; weightKg: number };
export type CockpitSleep = {
  date: string;
  asleepMinutes: number;
  status: string;
  bedtime: string | null;
  wakeAt: string | null;
};
export type CockpitActivity = {
  date: string;
  steps: number;
  activeCaloriesKcal: number;
  distanceMeters: number;
};
export type CockpitVitals = {
  date: string;
  heartRateAvgBpm: number | null;
};

export type CockpitSnapshot = {
  weight: CockpitWeight | null;
  sleep: CockpitSleep | null;
  activity: CockpitActivity | null;
  vitals: CockpitVitals | null;
};

export type CockpitBlock = {
  key: "weight" | "sleep" | "activity" | "vitals";
  title: string;
  primary: string;
  secondary: string;
  tertiary: string | null;
};

const SLEEP_STATUSES: readonly string[] = [
  "optimal",
  "acceptable",
  "mild_sleep_debt",
  "high_sleep_debt",
  "fragmented_sleep",
  "irregular_schedule",
  "low_confidence",
];

/** The sleep status label for a known status code; anything else shows as given. */
function sleepStatusText(status: string, i18n: I18n): string {
  return SLEEP_STATUSES.includes(status)
    ? i18n._(sleepStatusLabel(status as SleepDailyLike["status"]))
    : status;
}

/** Text is rendered through `i18n` (#67), so the blocks follow the active language. */
export function buildCockpitBlocks(snapshot: CockpitSnapshot, i18n: I18n): CockpitBlock[] {
  const weight = snapshot.weight;
  const sleep = snapshot.sleep;
  const vitals = snapshot.vitals;
  return [
    {
      key: "weight",
      title: i18n._(msg`Weight`),
      primary: weight ? formatKg(weight.weightKg) : "—",
      secondary: weight ? i18n._(msg`Last reading · ${weight.date}`) : i18n._(msg`No reading yet`),
      tertiary: null,
    },
    {
      key: "sleep",
      title: i18n._(msg`Sleep`),
      primary: sleep ? formatSleepDuration(sleep.asleepMinutes) : "—",
      secondary: sleep
        ? `${sleep.date} · ${sleepStatusText(sleep.status, i18n)}`
        : i18n._(msg`No sleep logged`),
      tertiary:
        snapshot.sleep && snapshot.sleep.bedtime && snapshot.sleep.wakeAt
          ? `${snapshot.sleep.bedtime} → ${snapshot.sleep.wakeAt}`
          : null,
    },
    {
      key: "activity",
      title: i18n._(msg`Activity`),
      primary: snapshot.activity ? formatSteps(snapshot.activity.steps) : "—",
      secondary: snapshot.activity
        ? `${snapshot.activity.date} · ${formatKcalories(snapshot.activity.activeCaloriesKcal)} · ${formatDistanceMeters(snapshot.activity.distanceMeters)}`
        : i18n._(msg`No activity logged`),
      tertiary: null,
    },
    {
      key: "vitals",
      title: i18n._(msg`Heart rate`),
      primary: vitals && vitals.heartRateAvgBpm !== null ? formatBpm(vitals.heartRateAvgBpm) : "—",
      secondary: vitals ? i18n._(msg`Avg · ${vitals.date}`) : i18n._(msg`No reading yet`),
      tertiary: null,
    },
  ];
}
