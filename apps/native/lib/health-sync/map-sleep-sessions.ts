import type { MobileHealthRecordInput } from "@openhealth/api/contracts/mobile-ingest";

/**
 * HealthKit sleep stage segments → one or more `sleep_session` records on the
 * mobile ingest contract (Issue #52).
 *
 * Each HKCategoryValueSleepAnalysis sample is a `{ value, startDate, endDate }`.
 * Values: `inBed`, `asleepUnspecified`, `asleepCore` (light), `asleepDeep`,
 * `asleepREM`, `awake`. We:
 *
 * 1. Drop segments shorter than 60s — those are noise on most watches.
 * 2. Map HK values to the contract's closed enum.
 * 3. Group consecutive segments whose gaps are ≤ 90 minutes into one session.
 * 4. Emit one `sleep_session` per group.
 *
 * Pure TypeScript, no RN imports — runs under `bun test`.
 */

export type HealthKitSleepValue =
  | "inBed"
  | "asleepUnspecified"
  | "asleepCore"
  | "asleepDeep"
  | "asleepREM"
  | "awake"
  | string; // unknown values fall through

export type HealthKitSleepSegment = {
  uuid: string;
  value: HealthKitSleepValue;
  startDate: string | Date;
  endDate: string | Date;
  sourceApp?: string | null;
  deviceModel?: string | null;
};

type SleepStage = "awake" | "light" | "deep" | "rem" | "asleep" | "out_of_bed" | "unknown";

export type GroupSleepOptions = {
  /** Minimum segment length in ms; shorter segments are dropped. Default 60_000. */
  minSegmentMs?: number;
  /** Maximum gap between segments within the same session, ms. Default 90 * 60_000. */
  maxGapMs?: number;
};

function toMs(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function pickStage(value: HealthKitSleepValue): SleepStage {
  switch (value) {
    case "inBed":
      return "out_of_bed";
    case "asleepUnspecified":
      return "asleep";
    case "asleepCore":
      return "light";
    case "asleepDeep":
      return "deep";
    case "asleepREM":
      return "rem";
    case "awake":
      return "awake";
    default:
      return "unknown";
  }
}

export function groupHealthKitSleepSessions(
  segments: readonly HealthKitSleepSegment[],
  options: GroupSleepOptions = {},
): Extract<MobileHealthRecordInput, { type: "sleep_session" }>[] {
  const minSegmentMs = options.minSegmentMs ?? 60_000;
  const maxGapMs = options.maxGapMs ?? 90 * 60_000;

  const sorted = [...segments]
    .filter((s) => Number.isFinite(toMs(s.startDate)) && Number.isFinite(toMs(s.endDate)))
    .map((s) => ({ segment: s, startMs: toMs(s.startDate), endMs: toMs(s.endDate) }))
    .filter(({ startMs, endMs }) => endMs > startMs && endMs - startMs >= minSegmentMs)
    .sort((a, b) => a.startMs - b.startMs);

  const sessions: Extract<MobileHealthRecordInput, { type: "sleep_session" }>[] = [];
  let current: {
    anchor: HealthKitSleepSegment;
    startMs: number;
    endMs: number;
    stages: { stage: SleepStage; startTime: string; endTime: string }[];
  } | null = null;

  for (const entry of sorted) {
    if (!current || entry.startMs - current.endMs > maxGapMs) {
      if (current) sessions.push(finishSession(current));
      current = {
        anchor: entry.segment,
        startMs: entry.startMs,
        endMs: entry.endMs,
        stages: [
          {
            stage: pickStage(entry.segment.value),
            startTime: toIso(entry.segment.startDate),
            endTime: toIso(entry.segment.endDate),
          },
        ],
      };
    } else {
      current.endMs = Math.max(current.endMs, entry.endMs);
      current.stages.push({
        stage: pickStage(entry.segment.value),
        startTime: toIso(entry.segment.startDate),
        endTime: toIso(entry.segment.endDate),
      });
    }
  }
  if (current) sessions.push(finishSession(current));
  return sessions;
}

function finishSession(current: {
  anchor: HealthKitSleepSegment;
  startMs: number;
  endMs: number;
  stages: { stage: SleepStage; startTime: string; endTime: string }[];
}): Extract<MobileHealthRecordInput, { type: "sleep_session" }> {
  const startIso = new Date(current.startMs).toISOString();
  const endIso = new Date(current.endMs).toISOString();
  return {
    type: "sleep_session",
    externalRecordId: current.anchor.uuid,
    sourceApp: current.anchor.sourceApp ?? "com.apple.health",
    startTime: startIso,
    endTime: endIso,
    ...(current.anchor.deviceModel ? { sourceDevice: { model: current.anchor.deviceModel } } : {}),
    stages: current.stages,
  };
}
