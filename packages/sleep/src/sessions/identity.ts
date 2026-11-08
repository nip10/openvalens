/**
 * TypeScript port of Gadgetbridge's sleep-session identity / overlap-replace
 * pattern and the Huami stage-window conversion.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huami/HuamiSleepSessionProvider.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huami/HuamiSleepSessionProvider.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Huami reports are ordered by report time, and a revised report can shift a
 * night's bounds. Revisions are therefore identified by **time overlap**, not
 * by exact start: every stored session overlapping the new candidate is
 * removed and the candidate takes its place. This module keeps that rule
 * pure; persistence is a later lane.
 */

import type { SleepSessionCandidate, SleepStage, StoredSleepSession } from "./types";

/** Milliseconds in a day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Huami includes both endpoint minutes in each native stage, so a stage that
 * ends at minute `n` actually ends at `(n + 1) * 60` seconds.
 */
export const HUAMI_INCLUSIVE_END_MINUTE_OFFSET = 1;

/**
 * Converts a Huami stage's native minute window to an epoch-millisecond
 * `[start, end)` window.
 *
 * Upstream subtracts one day from the report's midnight because the record
 * timestamp is the report time (which may be on the following day), while the
 * stage minutes are relative to the previous midnight.
 */
export function huamiStageWindow(
  timestampMidnightMs: number,
  startMinute: number,
  endMinute: number,
): { start: number; end: number } {
  const base = timestampMidnightMs - DAY_MS;
  return {
    start: base + startMinute * 60_000,
    end: base + (endMinute + HUAMI_INCLUSIVE_END_MINUTE_OFFSET) * 60_000,
  };
}

/**
 * Replaces every stored session that time-overlaps `candidate` with the
 * candidate, preserving the identity of the night across re-detections:
 *
 * - If exactly one stored session overlaps and its content is unchanged, the
 *   list is returned untouched (an unchanged re-detection is skipped).
 * - Otherwise all overlapping stored sessions are removed and the candidate is
 *   inserted. The earliest overlapping session's `id` is kept, so a revised
 *   detection updates the existing record instead of creating a duplicate; a
 *   candidate that overlaps nothing keeps its own `id`.
 *
 * The result is sorted by start time, as upstream's final `sortedBy`.
 */
export function replaceOverlappingSessions(
  existing: readonly StoredSleepSession[],
  candidate: SleepSessionCandidate,
): StoredSleepSession[] {
  const overlapping = existing.filter((session) => overlaps(session, candidate));

  if (overlapping.length === 1 && sessionContentEquals(overlapping[0]!, candidate)) {
    return [...existing];
  }

  let id = candidate.id;
  if (overlapping.length > 0) {
    let earliest = overlapping[0]!;
    for (const session of overlapping) {
      if (session.start < earliest.start) earliest = session;
    }
    id = earliest.id;
  }

  const merged = existing.filter((session) => !overlaps(session, candidate));
  merged.push({
    id,
    start: candidate.start,
    end: candidate.end,
    stages: [...candidate.stages],
  });
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

/** Upstream's strict overlap test: `it.start < candidate.end && candidate.start < it.end`. */
function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function sessionContentEquals(
  left: { start: number; end: number; stages: readonly SleepStage[] },
  right: { start: number; end: number; stages: readonly SleepStage[] },
): boolean {
  return (
    left.start === right.start && left.end === right.end && stagesEqual(left.stages, right.stages)
  );
}

function stagesEqual(left: readonly SleepStage[], right: readonly SleepStage[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.kind !== b.kind || a.start !== b.start || a.end !== b.end) return false;
  }
  return true;
}
