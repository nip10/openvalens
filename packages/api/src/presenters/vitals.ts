/**
 * Vitals presentation shared by web and mobile. Pure TypeScript — safe for
 * the app bundle. Copy follows docs/mobile/tone-of-voice.md (sentence case,
 * real units).
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export type DailyVitalsLike = {
  date: string;
  heartRate: {
    avgBpm: number | null;
    minBpm: number | null;
    maxBpm: number | null;
    sampleCount: number;
  };
  restingHeartRate: {
    avgBpm: number | null;
    sampleCount: number;
  };
  /** Overnight HRV (RMSSD), ms. Optional: rows cached before it existed lack it. */
  hrv?: {
    avgMs: number | null;
    sampleCount: number;
  };
};

export type VitalsSampleLike = {
  sampledAt: string;
  heartRateBpm: number;
  source: string | null;
};

export type VitalsSummary = {
  days: DailyVitalsLike[];
  today: DailyVitalsLike | null;
  sevenDayAverageBpm: number | null;
  latestSample: VitalsSampleLike | null;
  /** Most recent day with an HRV value, or null (phone-only setups usually have none). */
  latestHrv: { date: string; avgMs: number } | null;
};

/** Rounded mean across the days that actually have samples; null otherwise. */
export function summarizeVitals(
  days: readonly DailyVitalsLike[],
  samples: readonly VitalsSampleLike[],
): VitalsSummary {
  const last7 = days.slice(-7);
  const activeDays = last7.filter((day) => day.heartRate.avgBpm !== null);
  const sevenDayAverageBpm =
    activeDays.length > 0
      ? Math.round(
          activeDays.reduce((sum, day) => sum + (day.heartRate.avgBpm ?? 0), 0) / activeDays.length,
        )
      : null;

  return {
    days: [...days],
    today: days.at(-1) ?? null,
    sevenDayAverageBpm,
    latestSample: samples[0] ?? null,
    latestHrv: latestHrv(days),
  };
}

function latestHrv(days: readonly DailyVitalsLike[]): { date: string; avgMs: number } | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    const avgMs = day?.hrv?.avgMs;
    if (day && avgMs !== null && avgMs !== undefined) return { date: day.date, avgMs };
  }
  return null;
}

/** "45 ms" / "—". */
export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)} ms`;
}

/** "72 bpm" / "—". */
export function formatBpm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)} bpm`;
}

/** "72 bpm (65 bpm–88 bpm)" / "—" when min/max missing. */
export function formatBpmRange(avg: number | null, min: number | null, max: number | null): string {
  if (avg === null) return "—";
  if (min === null || max === null) return formatBpm(avg);
  return `${formatBpm(avg)} (${formatBpm(min)}–${formatBpm(max)})`;
}

/** Chart series: oldest-first daily avg bpm. */
export function heartRateSeries(days: readonly DailyVitalsLike[]): {
  date: string;
  avgBpm: number | null;
  label: string;
}[] {
  return days.map((day) => ({
    date: day.date,
    avgBpm: day.heartRate.avgBpm,
    label: day.date.slice(5),
  }));
}

/**
 * "Health Connect" / "Apple Health" / "Other" — sentence-case source label.
 * Source names are brand names and stay as they are; only "Other" is
 * translated.
 */
export function vitalsSourceLabel(source: string | null, i18n: I18n): string {
  if (source?.includes("health_connect")) return "Health Connect";
  if (source?.includes("apple_health") || source?.includes("healthkit")) return "Apple Health";
  return i18n._(msg({ message: "Other", context: "data source" }));
}
