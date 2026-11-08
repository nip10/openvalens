/**
 * TypeScript port of Gadgetbridge's sleep-stage sanitizing and grouping.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionProvider.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionProvider.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Devices sometimes report overlapping/duplicate stage samples (e.g. a stage
 * re-sent with a slightly different start after a later sync). `sanitizeStages`
 * repairs one session's stages; `groupIntoSessions` splits an arbitrary stage
 * list into sessions at time gaps. Both are pure and deterministic.
 */

import { makeSleepSession, stageDurationSeconds } from "./types";
import type { SleepSession, SleepStage } from "./types";

/** Upstream looks back one day when finding sessions by their end time. */
export const MAX_SESSION_SECONDS = 24 * 60 * 60;

/**
 * Sanitizes a list of sleep stages into a known session start/end.
 *
 * Rules, verbatim from upstream:
 * - Honor the start time of each stage.
 * - Clip each stage to end no later than the next one starts (the reported
 *   `end` of every stage except the last is ignored).
 * - Drop stages that fully overlap the previous one.
 * - Merge a stage into the previous one when they are the same kind and touch.
 * - If the first stage starts after the reported bedtime, pad the gap with
 *   light sleep.
 * - If no stage is usable, return one light-sleep stage for the whole span.
 *
 * Returns null when `endTime <= startTime`.
 *
 * `stages` is expected in start-time order; upstream does not sort here.
 */
export function sanitizeStages(
  stages: readonly SleepStage[],
  startTime: number,
  endTime: number,
): SleepSession | null {
  if (endTime <= startTime) return null;

  const sanitized: SleepStage[] = [];

  const firstStageTimestamp = stages[0]?.start;
  if (firstStageTimestamp !== undefined && firstStageTimestamp > startTime) {
    // The stage samples start later than the reported bedtime (e.g. fall-asleep time
    // vs bedtime) - fill the gap as light sleep.
    sanitized.push({ kind: "light", start: startTime, end: firstStageTimestamp });
  }

  for (let index = 0; index < stages.length; index += 1) {
    const sample = stages[index]!;
    const end = index < stages.length - 1 ? stages[index + 1]!.start : endTime;
    const last = sanitized[sanitized.length - 1];
    const start = Math.max(sample.start, last ? last.end : sample.start);
    if (start >= end) continue;

    if (last && last.kind === sample.kind && last.end === start) {
      sanitized[sanitized.length - 1] = { kind: sample.kind, start: last.start, end };
    } else {
      sanitized.push({ kind: sample.kind, start, end });
    }
  }

  if (sanitized.length === 0) {
    // No stages sent by the watch, or none usable - add a single stage for the entire duration.
    sanitized.push({ kind: "light", start: startTime, end: endTime });
  }

  return makeSleepSession(sanitized);
}

/**
 * Groups arbitrary sleep stages into sessions, creating a new session whenever
 * there is a time gap between stages. Stages are sorted by start time first;
 * overlapping stages are clipped or dropped as in `sanitizeStages`.
 *
 * Upstream also skips `ActivityKind.UNKNOWN`; `SleepStage` cannot carry that
 * kind (upstream's own model restricts it to the five sleep kinds), so there
 * is nothing to skip here.
 */
export function groupIntoSessions(allStages: readonly SleepStage[]): SleepSession[] {
  const sessions: SleepSession[] = [];
  let stages: SleepStage[] = [];

  const sorted = [...allStages].sort((a, b) => a.start - b.start);
  for (const sample of sorted) {
    // Upstream computes the end from the stage's whole-second duration, not its
    // reported end, so sub-second ends are truncated the same way here.
    const end = sample.start + stageDurationSeconds(sample) * 1000;
    const lastEnd = stages[stages.length - 1]?.end;
    if (lastEnd !== undefined && sample.start > lastEnd) {
      // The previous session ended - wrap it up and start a new one.
      if (stages.length > 0) sessions.push(makeSleepSession(stages));
      stages = [];
    }

    const last = stages[stages.length - 1];
    const start = Math.max(sample.start, last ? last.end : sample.start);
    if (start >= end) continue;

    if (last && last.kind === sample.kind && last.end === start) {
      stages[stages.length - 1] = { kind: sample.kind, start: last.start, end };
    } else {
      stages.push({ kind: sample.kind, start, end });
    }
  }

  if (stages.length > 0) sessions.push(makeSleepSession(stages));
  return sessions;
}

/**
 * Upstream `SleepSessionProvider.getSleepSessionsEndingIn`: sessions are
 * attributed to the day they **end** (the wake day), not the day they start.
 * The fetch window is widened by `MAX_SESSION_SECONDS` so a night that began
 * the previous evening is still returned.
 *
 * `getSleepSessions` must return every session that starts in
 * `[fromMs, toMs)`. The filter is `(fromMs, toMs]` on the end time, matching
 * upstream's `(tsFrom + 1)..tsTo` in whole epoch seconds.
 */
export function getSleepSessionsEndingIn(
  getSleepSessions: (fromMs: number, toMs: number) => readonly SleepSession[],
  fromMs: number,
  toMs: number,
): SleepSession[] {
  const fromSeconds = Math.trunc(fromMs / 1000);
  const toSeconds = Math.trunc(toMs / 1000);
  const lookBackMs = MAX_SESSION_SECONDS * 1000;
  return getSleepSessions(fromMs - lookBackMs, toMs).filter((session) => {
    const endSeconds = Math.trunc(session.end / 1000);
    return endSeconds > fromSeconds && endSeconds <= toSeconds;
  });
}
