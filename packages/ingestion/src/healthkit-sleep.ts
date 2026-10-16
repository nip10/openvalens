import { createHash } from "node:crypto";

import type { SleepStageInterval } from "./health-connect";

/**
 * HealthKit sleep segments → sleep sessions (#131, building on #52). Pure.
 *
 * HealthKit stores `HKCategoryTypeIdentifierSleepAnalysis` as one sample per
 * stage segment (in bed, asleep core/deep/REM/unspecified, awake), not as
 * sessions. The device sends the samples it reads from an anchored query
 * as `sleep_segment` records; the server keeps every segment inside the
 * session row it belongs to and regroups the affected sessions whenever
 * segments are added or deleted. Grouping on the server means a deletion
 * (which HealthKit reports as a bare UUID) can always be resolved, and the
 * device keeps no health data.
 *
 * Rules, applied per source (one `data_source`: source app + device):
 * - Segments with an invalid interval, or longer than `maxSegmentMs`, are
 *   dropped. A repeated UUID keeps its last copy.
 * - Segments chain into one session while the next starts at most
 *   `maxGapMs` after the furthest end so far. Grouping uses UTC instants
 *   only, so midnight, DST changes and time-zone travel never split a night.
 * - Overlapping segments are flattened by priority
 *   awake > REM > deep > core > unspecified > in bed (same order as the
 *   sleep summary). In-bed time not covered by an asleep or awake segment
 *   becomes `awake` (Health Connect's "awake in bed"), but only when the
 *   source recorded sleep at all: an in-bed-only session carries no stages,
 *   so the summary treats it as unstaged rather than as zero sleep.
 * - The session id is derived from its member UUIDs, so regrouping the same
 *   segments always yields the same id (idempotent replays), and any change
 *   in membership yields a new id that supersedes the old row.
 */
export type HealthKitSleepValue =
  | "in_bed"
  | "asleep_unspecified"
  | "awake"
  | "asleep_core"
  | "asleep_deep"
  | "asleep_rem";

export type HealthKitSleepSegment = {
  /** HealthKit sample UUID. */
  id: string;
  value: HealthKitSleepValue;
  startTime: string;
  endTime: string;
  /** IANA zone the segment was recorded in. */
  timeZone?: string;
};

export type HealthKitSleepSession = {
  externalRecordId: string;
  startTime: string;
  endTime: string;
  /** Member segments, sorted by start time then id. */
  segments: HealthKitSleepSegment[];
  segmentIds: string[];
  stageIntervals: SleepStageInterval[];
  timeZone: string;
  /** Local date of the session end in `timeZone` (the sleep day). */
  localDate: string;
};

export type GroupSleepOptions = {
  /** Largest gap between segments of one session. Default 90 minutes. */
  maxGapMs?: number;
  /** Longer segments are treated as bad data. Default 24 hours. */
  maxSegmentMs?: number;
  /** Zone for segments without one. Default UTC. */
  fallbackTimeZone?: string;
};

export const SLEEP_SESSION_MAX_GAP_MS = 90 * 60_000;
const DAY_MS = 86_400_000;

const PRIORITY: Record<HealthKitSleepValue, number> = {
  in_bed: 0,
  asleep_unspecified: 1,
  asleep_core: 2,
  asleep_deep: 3,
  asleep_rem: 4,
  awake: 5,
};

const STAGE: Record<Exclude<HealthKitSleepValue, "in_bed">, string> = {
  asleep_unspecified: "asleep",
  asleep_core: "light",
  asleep_deep: "deep",
  asleep_rem: "rem",
  awake: "awake",
};

type Timed = { segment: HealthKitSleepSegment; startMs: number; endMs: number };

function toTimed(segment: HealthKitSleepSegment, maxSegmentMs: number): Timed | null {
  if (!(segment.value in PRIORITY)) return null;
  const startMs = new Date(segment.startTime).getTime();
  const endMs = new Date(segment.endTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs || endMs - startMs > maxSegmentMs) return null;
  return { segment, startMs, endMs };
}

/** Whether grouping would keep this segment. */
export function isUsableSleepSegment(
  segment: HealthKitSleepSegment,
  options: GroupSleepOptions = {},
): boolean {
  return toTimed(segment, options.maxSegmentMs ?? DAY_MS) !== null;
}

/** Stable session id: a hash of the sorted member UUIDs. */
export function sleepSessionId(segmentIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...segmentIds].sort().join("\n"))
    .digest("hex");
  return `apple_health-sleep-${digest.slice(0, 32)}`;
}

/** `YYYY-MM-DD` of an instant in `timeZone`; an unknown zone falls back to UTC. */
export function localDateIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Flattens one session's overlapping segments into contract stage intervals. */
export function flattenSleepStages(
  segments: readonly HealthKitSleepSegment[],
): SleepStageInterval[] {
  const timed = segments.flatMap((segment) => {
    const entry = toTimed(segment, Number.POSITIVE_INFINITY);
    return entry ? [entry] : [];
  });
  const recordsSleep = timed.some((entry) => entry.segment.value !== "in_bed");
  if (!recordsSleep) return [];

  const boundaries = [...new Set(timed.flatMap((entry) => [entry.startMs, entry.endMs]))].sort(
    (a, b) => a - b,
  );
  const intervals: { stage: string; startMs: number; endMs: number }[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    let top: HealthKitSleepValue | null = null;
    for (const entry of timed)
      if (entry.startMs < endMs && entry.endMs > startMs)
        if (top === null || PRIORITY[entry.segment.value] > PRIORITY[top])
          top = entry.segment.value;
    if (top === null) continue; // a gap: no data, left unstaged
    const stage = top === "in_bed" ? "awake" : STAGE[top];
    const previous = intervals[intervals.length - 1];
    if (previous && previous.endMs === startMs && previous.stage === stage) previous.endMs = endMs;
    else intervals.push({ stage, startMs, endMs });
  }
  return intervals.map(({ stage, startMs, endMs }) => ({
    stage,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  }));
}

/** Groups one source's segments into sessions, ordered by start time. */
export function groupSleepSegments(
  segments: readonly HealthKitSleepSegment[],
  options: GroupSleepOptions = {},
): HealthKitSleepSession[] {
  const maxGapMs = options.maxGapMs ?? SLEEP_SESSION_MAX_GAP_MS;
  const maxSegmentMs = options.maxSegmentMs ?? DAY_MS;
  const fallbackTimeZone = options.fallbackTimeZone ?? "UTC";

  const byId = new Map<string, HealthKitSleepSegment>();
  for (const segment of segments) byId.set(segment.id, segment);
  const timed = [...byId.values()]
    .flatMap((segment) => {
      const entry = toTimed(segment, maxSegmentMs);
      return entry ? [entry] : [];
    })
    .sort(
      (a, b) =>
        a.startMs - b.startMs ||
        a.endMs - b.endMs ||
        (a.segment.id < b.segment.id ? -1 : a.segment.id > b.segment.id ? 1 : 0),
    );

  const groups: { entries: Timed[]; endMs: number }[] = [];
  for (const entry of timed) {
    const current = groups[groups.length - 1];
    if (current && entry.startMs - current.endMs <= maxGapMs) {
      current.entries.push(entry);
      current.endMs = Math.max(current.endMs, entry.endMs);
    } else groups.push({ entries: [entry], endMs: entry.endMs });
  }

  return groups.map(({ entries, endMs }) => {
    const members = entries.map((entry) => entry.segment);
    const segmentIds = members.map((segment) => segment.id).sort();
    const startTime = new Date(entries[0]!.startMs).toISOString();
    const endTime = new Date(endMs).toISOString();
    // The zone where the night ended: the latest-ending segment that has one.
    const zoned = [...entries]
      .sort((a, b) => b.endMs - a.endMs)
      .find((entry) => entry.segment.timeZone && isValidTimeZone(entry.segment.timeZone));
    const timeZone = zoned?.segment.timeZone ?? fallbackTimeZone;
    return {
      externalRecordId: sleepSessionId(segmentIds),
      startTime,
      endTime,
      segments: members,
      segmentIds,
      stageIntervals: flattenSleepStages(members),
      timeZone,
      localDate: localDateIn(endTime, timeZone),
    };
  });
}
