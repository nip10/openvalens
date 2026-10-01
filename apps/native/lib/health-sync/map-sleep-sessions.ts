import type { MobileHealthRecordInput } from "@openhealth/api/contracts/mobile-ingest";

/**
 * HealthKit sleep stage segments → one or more `sleep_session` records on the
 * mobile ingest contract (Issue #52, #40).
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
  value: HealthKitSleepValue;
  startDate: string | Date;
  endDate: string | Date;
};

export type GroupSleepOptions = {
  /** Minimum segment length in ms; shorter segments are dropped. Default 60_000. */
  minSegmentMs?: number;
  /** Maximum gap between segments within the same session, ms. Default 90 * 60_000. */
  maxGapMs?: number;
  /** App's own bundle id; segments it wrote are filtered out upstream. */
  ownBundleId: string;
  /** Stable id source: usually `segment.uuid` from HK. */
  uuidForSegment: (segment: HealthKitSleepSegment) => string;
};

const HK_TO_STAGE: Record<string, MobileHealthRecordInput["type"] extends "sleep_session"
  ? NonNullable<Extract<MobileHealthRecordInput, { type: "sleep_session" }>["stages"]>[number]["stage"]
  : never> = {
  inBed: "out_of_bed",
  asleepUnspecified: "asleep",
  asleepCore: "light",
  asleepDeep: "deep",
  asleepREM: "rem",
  awake: "awake",
};

function toMs(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function pickStage(value: HealthKitSleepValue):
  | "awake"
  | "light"
  | "deep"
  | "rem"
  | "asleep"
  | "out_of_bed"
  | "unknown" {
  return (HK_TO_STAGE[value] as ReturnType<typeof pickStage>) ?? "unknown";
}

/**
 * Group segments into sessions. Returns the mobile-ingest records, one per
 * session. Stable dedupe keys are produced from the first segment's id.
 */
export function groupHealthKitSleepSessions(
  segments: readonly HealthKitSleepSegment[],
  options: GroupSleepOptions,
): Extract<MobileHealthRecordInput, { type: "sleep_session" }>[] {
  const minSegmentMs = options.minSegmentMs ?? 60_000;
  const maxGapMs = options.maxGapMs ?? 90 * 60_000;

  const sorted = [...segments]
    .filter((segment) => Number.isFinite(toMs(segment.startDate)) && Number.isFinite(toMs(segment.endDate)))
    .map((segment) => ({ segment, startMs: toMs(segment.startDate), endMs: toMs(segment.endDate) }))
    .filter(({ startMs, endMs }) => endMs > startMs && endMs - startMs >= minSegmentMs)
    .sort((a, b) => a.startMs - b.startMs);

  const sessions: Extract<MobileHealthRecordInput, { type: "sleep_session" }>[] = [];
  let current: { segment: HealthKitSleepSegment; startMs: number; endMs: number; stages: { stage: ReturnType<typeof pickStage>; startTime: string; endTime: string }[] } | null = null;

  for (const entry of sorted) {
    if (!current || entry.startMs - current.endMs > maxGapMs) {
      if (current) sessions.push(finishSession(current, options));
      current = {
        segment: entry.segment,
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
  if (current) sessions.push(finishSession(current, options));
  return sessions;
}

function finishSession(
  current: {
    segment: HealthKitSleepSegment;
    startMs: number;
    endMs: number;
    stages: { stage: ReturnType<typeof pickStage>; startTime: string; endTime: string }[];
  },
  options: GroupSleepOptions,
): Extract<MobileHealthRecordInput, { type: "sleep_session" }> {
  const startIso = new Date(current.startMs).toISOString();
  const endIso = new Date(current.endMs).toISOString();
  const dedupeKey = options.uuidForSegment(current.segment);
  return {
    type: "sleep_session",
    observedAt: startIso,
    startTime: startIso,
    endTime: endIso,
    source: "apple_health",
    stages: current.stages,
    dedupeKey: `apple_health-sleep-${dedupeKey}`,
  };
}