import { scoreSleepSummary } from "./scoring";
import type { SleepDailySummary, SleepSessionInput, SleepStage } from "./types";

/**
 * Deterministic per-(date) sleep summary derivation (Issue #18).
 *
 * Verbatim port of `anchovy/apps/web/src/lib/v2/sleep/derive-daily-summary.ts`.
 * One summary is produced per `date` (currently keyed on the UTC end date of
 * each session — timezone-local sleep-day support is intentionally deferred until
 * the migration that adds `user_id` to `health_event` also adds a sleep-day
 * column).
 *
 * No PHI is logged. The function is pure: same inputs → same outputs.
 */
type DeriveSleepDailySummariesInput = {
  targetMinutes?: number;
  sessions: SleepSessionInput[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_VALID_DURATION_MS = 10 * 60 * 1000;
const MAX_VALID_DURATION_MS = DAY_MS;
const DUPLICATE_OVERLAP_THRESHOLD = 0.8;

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeStage(stage: string): SleepStage {
  const value = stage.toLowerCase();
  if (value.includes("awake") || value.includes("wake")) return "awake";
  if (value.includes("deep")) return "deep";
  if (value.includes("rem")) return "rem";
  if (value.includes("light")) return "light";
  return "unknown";
}

function clampIntervalToSession(
  intervalStart: string,
  intervalEnd: string,
  sessionStartMs: number,
  sessionEndMs: number,
): { startMs: number; endMs: number } | null {
  const startMs = new Date(intervalStart).getTime();
  const endMs = new Date(intervalEnd).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const clampedStartMs = Math.max(startMs, sessionStartMs);
  const clampedEndMs = Math.min(endMs, sessionEndMs);
  if (clampedEndMs <= clampedStartMs) return null;

  return { startMs: clampedStartMs, endMs: clampedEndMs };
}

function countAwakeInterruptions(
  stages: SleepSessionInput["stageIntervals"],
  startMs: number,
  endMs: number,
): number {
  return (stages ?? []).reduce((count, interval) => {
    if (normalizeStage(interval.stage) !== "awake") return count;
    return clampIntervalToSession(interval.start, interval.end, startMs, endMs) ? count + 1 : count;
  }, 0);
}

function sessionAsleepMinutes(session: SleepSessionInput): number {
  const startMs = new Date(session.start).getTime();
  const endMs = new Date(session.end as string).getTime();
  const stageMinutes = (session.stageIntervals ?? []).reduce((awake, interval) => {
    if (normalizeStage(interval.stage) !== "awake") return awake;
    const clamped = clampIntervalToSession(interval.start, interval.end, startMs, endMs);
    return clamped ? awake + Math.round((clamped.endMs - clamped.startMs) / 60000) : awake;
  }, 0);
  return Math.max(0, Math.round((endMs - startMs) / 60000) - stageMinutes);
}

function sourcePreferenceScore(session: SleepSessionInput): number {
  const source = `${session.sourceApp ?? ""} ${session.sourceDevice ?? ""}`.toLowerCase();
  if (
    source.includes("watch") ||
    source.includes("oura") ||
    source.includes("ring") ||
    source.includes("wearable")
  ) {
    return 2;
  }
  if (source.includes("phone")) return 0;
  return 1;
}

function sessionDurationMs(session: SleepSessionInput): number {
  return new Date(session.end as string).getTime() - new Date(session.start).getTime();
}

function sessionSortScore(session: SleepSessionInput): [number, number] {
  return [sourcePreferenceScore(session), sessionDurationMs(session)];
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function normalizeIntervals(
  intervals: Array<{ startMs: number; endMs: number; stage: SleepStage }>,
): Array<{ startMs: number; endMs: number; stage: SleepStage }> {
  if (intervals.length === 0) return [];
  const priority: Record<SleepStage, number> = { unknown: 0, light: 1, deep: 2, rem: 3, awake: 4 };

  const boundaries = [
    ...new Set(intervals.flatMap((interval) => [interval.startMs, interval.endMs])),
  ].sort((a, b) => a - b);
  const accepted: Array<{ startMs: number; endMs: number; stage: SleepStage }> = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    const covering = intervals.filter(
      (interval) => interval.startMs < endMs && interval.endMs > startMs,
    );
    if (covering.length === 0) continue;

    const stage = covering.sort((left, right) => priority[right.stage] - priority[left.stage])[0]!
      .stage;
    const previous = accepted[accepted.length - 1];
    if (previous && previous.endMs === startMs && previous.stage === stage) {
      previous.endMs = endMs;
    } else {
      accepted.push({ startMs, endMs, stage });
    }
  }

  return accepted;
}

function mergeWindows(windows: Array<{ startMs: number; endMs: number }>): Array<{
  startMs: number;
  endMs: number;
}> {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (!last || window.startMs > last.endMs) {
      merged.push({ ...window });
      continue;
    }
    last.endMs = Math.max(last.endMs, window.endMs);
  }
  return merged;
}

function allocateStageMinutes(
  stageMs: Record<SleepStage, number>,
  targetMinutes: number,
): Record<SleepStage, number> {
  const stages: SleepStage[] = ["awake", "deep", "rem", "light", "unknown"];
  const entries = stages.map((stage) => {
    const exactMinutes = stageMs[stage] / 60000;
    const wholeMinutes = Math.floor(exactMinutes);
    return {
      stage,
      wholeMinutes,
      remainder: exactMinutes - wholeMinutes,
    };
  });

  let allocated = entries.reduce((sum, entry) => sum + entry.wholeMinutes, 0);
  for (const entry of entries.sort((left, right) => right.remainder - left.remainder)) {
    if (allocated >= targetMinutes) break;
    entry.wholeMinutes += 1;
    allocated += 1;
  }

  return entries.reduce(
    (acc, entry) => {
      acc[entry.stage] = entry.wholeMinutes;
      return acc;
    },
    { awake: 0, deep: 0, rem: 0, light: 0, unknown: 0 },
  );
}

export function deriveSleepDailySummaries({
  targetMinutes = 480,
  sessions,
}: DeriveSleepDailySummariesInput): SleepDailySummary[] {
  const byDate = new Map<string, SleepSessionInput[]>();

  for (const session of sessions) {
    if (!session.end) continue;
    const startMs = new Date(session.start).getTime();
    const endMs = new Date(session.end).getTime();
    const durationMs = endMs - startMs;
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      durationMs <= 0 ||
      durationMs < MIN_VALID_DURATION_MS ||
      durationMs > MAX_VALID_DURATION_MS
    ) {
      continue;
    }

    const date = toIsoDateUtc(new Date(endMs));
    const list = byDate.get(date) ?? [];
    list.push(session);
    byDate.set(date, list);
  }

  const summaries: SleepDailySummary[] = [];

  for (const [date, daySessions] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const accepted: SleepSessionInput[] = [];
    const sorted = [...daySessions].sort((a, b) => {
      const [ap, ad] = sessionSortScore(a);
      const [bp, bd] = sessionSortScore(b);
      return bd - ad || bp - ap;
    });

    for (const session of sorted) {
      const startMs = new Date(session.start).getTime();
      const endMs = new Date(session.end as string).getTime();
      const overlapping = accepted.filter((other) =>
        overlaps(
          startMs,
          endMs,
          new Date(other.start).getTime(),
          new Date(other.end as string).getTime(),
        ),
      );
      const maxOverlapRatio = overlapping.reduce((max, other) => {
        const otherStart = new Date(other.start).getTime();
        const otherEnd = new Date(other.end as string).getTime();
        const shorter = Math.min(endMs - startMs, otherEnd - otherStart);
        return Math.max(max, overlapMs(startMs, endMs, otherStart, otherEnd) / shorter);
      }, 0);
      if (maxOverlapRatio >= DUPLICATE_OVERLAP_THRESHOLD) {
        const preferredOverlaps = overlapping.filter((other) => {
          const otherStart = new Date(other.start).getTime();
          const otherEnd = new Date(other.end as string).getTime();
          const candidateDuration = endMs - startMs;
          const otherDuration = otherEnd - otherStart;
          const overlap = overlapMs(startMs, endMs, otherStart, otherEnd);
          const candidateOverlapRatio = overlap / candidateDuration;
          const otherOverlapRatio = overlap / otherDuration;
          return (
            sourcePreferenceScore(session) > sourcePreferenceScore(other) &&
            candidateOverlapRatio >= DUPLICATE_OVERLAP_THRESHOLD &&
            otherOverlapRatio >= DUPLICATE_OVERLAP_THRESHOLD &&
            candidateDuration >= otherDuration * DUPLICATE_OVERLAP_THRESHOLD
          );
        });
        if (preferredOverlaps.length === 0) continue;
        for (const other of preferredOverlaps) {
          const index = accepted.indexOf(other);
          if (index >= 0) accepted.splice(index, 1);
        }
      }
      accepted.push(session);
    }

    const sessionWindows = accepted.map((session) => ({
      session,
      startMs: new Date(session.start).getTime(),
      endMs: new Date(session.end as string).getTime(),
    }));
    const main = [...sessionWindows].sort((a, b) => {
      const [ap, ad] = sessionSortScore(a.session);
      const [bp, bd] = sessionSortScore(b.session);
      return bd - ad || bp - ap;
    })[0];
    const mergedWindows = mergeWindows(sessionWindows);
    const timeInBedMs = mergedWindows.reduce((acc, s) => acc + s.endMs - s.startMs, 0);
    const timeInBedMinutes = Math.round(timeInBedMs / 60000);

    const allStages = accepted.flatMap((session) =>
      (session.stageIntervals ?? []).flatMap((interval) => {
        const clamped = clampIntervalToSession(
          interval.start,
          interval.end,
          new Date(session.start).getTime(),
          new Date(session.end as string).getTime(),
        );
        return clamped ? [{ ...clamped, stage: normalizeStage(interval.stage) }] : [];
      }),
    );
    const normalizedStages = normalizeIntervals(allStages);
    const stageMs = normalizedStages.reduce(
      (acc, interval) => {
        acc[interval.stage] += interval.endMs - interval.startMs;
        return acc;
      },
      { awake: 0, deep: 0, rem: 0, light: 0, unknown: 0 },
    );
    const coveredStageMs = normalizedStages.reduce(
      (sum, interval) => sum + interval.endMs - interval.startMs,
      0,
    );
    const unknownStageMs = Math.max(0, timeInBedMs - coveredStageMs);
    const stageMinutes = allocateStageMinutes(
      {
        ...stageMs,
        unknown: stageMs.unknown + unknownStageMs,
      },
      timeInBedMinutes,
    );
    const interruptionsCount = accepted.reduce(
      (count, session) =>
        count +
        countAwakeInterruptions(
          session.stageIntervals,
          new Date(session.start).getTime(),
          new Date(session.end as string).getTime(),
        ),
      0,
    );

    const asleepMinutes = Math.max(0, timeInBedMinutes - stageMinutes.awake);
    const sleepEfficiencyPct =
      timeInBedMinutes > 0
        ? Math.min(100, Math.max(0, Math.round((asleepMinutes / timeInBedMinutes) * 1000) / 10))
        : null;
    const sleepMidpoint = main
      ? new Date(main.startMs + (main.endMs - main.startMs) / 2).toISOString()
      : null;
    const { qualityScore, confidence, status } = scoreSleepSummary({
      asleepMinutes,
      sleepDebtMinutes: Math.max(0, targetMinutes - asleepMinutes),
      sleepEfficiencyPct,
      deepMinutes: stageMinutes.deep,
      remMinutes: stageMinutes.rem,
      lightMinutes: stageMinutes.light,
      unknownStageMinutes: stageMinutes.unknown,
      interruptionsCount,
      targetMinutes,
    });

    summaries.push({
      date,
      mainSleepStart: main?.session.start ?? null,
      mainSleepEnd: main?.session.end ?? null,
      mainSleepAsleepMinutes: main ? sessionAsleepMinutes(main.session) : null,
      asleepMinutes,
      timeInBedMinutes,
      awakeMinutes: stageMinutes.awake,
      sleepEfficiencyPct,
      deepMinutes: stageMinutes.deep,
      remMinutes: stageMinutes.rem,
      lightMinutes: stageMinutes.light,
      unknownStageMinutes: stageMinutes.unknown,
      interruptionsCount,
      sleepMidpoint,
      targetMinutes,
      sleepDebtMinutes: Math.max(0, targetMinutes - asleepMinutes),
      qualityScore,
      confidence,
      status,
      sourceSummary: main
        ? [main.session.sourceApp, main.session.sourceDevice].filter(Boolean).join(" / ") || null
        : null,
      sessionIds: accepted.map((session) => session.id),
    });
  }

  return summaries;
}
