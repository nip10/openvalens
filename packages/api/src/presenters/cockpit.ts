/**
 * Cockpit presentation shared by web and mobile — composes today's snapshot
 * from the body, sleep, activity and vitals read paths. No imports: safe for
 * the app bundle. Copy follows docs/mobile/tone-of-voice.md.
 */
import { formatKg } from "./body";
import { formatSleepDuration } from "./sleep";
import { formatSteps, formatKcalories, formatDistanceMeters } from "./activity";
import { formatBpm } from "./vitals";

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

export function buildCockpitBlocks(snapshot: CockpitSnapshot): CockpitBlock[] {
  return [
    {
      key: "weight",
      title: "Weight",
      primary: snapshot.weight ? formatKg(snapshot.weight.weightKg) : "—",
      secondary: snapshot.weight ? `Last reading · ${snapshot.weight.date}` : "No reading yet",
      tertiary: null,
    },
    {
      key: "sleep",
      title: "Sleep",
      primary: snapshot.sleep ? formatSleepDuration(snapshot.sleep.asleepMinutes) : "—",
      secondary: snapshot.sleep
        ? `${snapshot.sleep.date} · ${snapshot.sleep.status}`
        : "No sleep logged",
      tertiary:
        snapshot.sleep && snapshot.sleep.bedtime && snapshot.sleep.wakeAt
          ? `${snapshot.sleep.bedtime} → ${snapshot.sleep.wakeAt}`
          : null,
    },
    {
      key: "activity",
      title: "Activity",
      primary: snapshot.activity ? formatSteps(snapshot.activity.steps) : "—",
      secondary: snapshot.activity
        ? `${snapshot.activity.date} · ${formatKcalories(snapshot.activity.activeCaloriesKcal)} · ${formatDistanceMeters(snapshot.activity.distanceMeters)}`
        : "No activity logged",
      tertiary: null,
    },
    {
      key: "vitals",
      title: "Heart rate",
      primary:
        snapshot.vitals && snapshot.vitals.heartRateAvgBpm !== null
          ? formatBpm(snapshot.vitals.heartRateAvgBpm)
          : "—",
      secondary: snapshot.vitals ? `Avg · ${snapshot.vitals.date}` : "No reading yet",
      tertiary: null,
    },
  ];
}
