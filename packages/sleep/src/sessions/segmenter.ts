/**
 * TypeScript port of Gadgetbridge's `SleepSessionSegmenter`.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionSegmenter.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionSegmenter.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Derives sleep sessions from an ordered list of activity samples. A session
 * opens on the first sleep-kind sample and closes when a non-sleep sample has
 * steps, or when the non-sleep run exceeds an hour. The last stage is extended
 * by a fixed 60 seconds so it has a non-zero duration even when the sample
 * provider reports exactly one sample per minute.
 */

import { isSleepKind, makeSleepSession } from "./types";
import type { SleepActivitySample, SleepSession, SleepStage, SleepStageKind } from "./types";

/**
 * A pending sleep session shorter than this (including its trailing wake
 * padding) is discarded.
 */
export const MIN_SESSION_LENGTH_SECONDS = 5 * 60;

/** A run of non-sleep samples longer than this closes the session. */
export const MAX_WAKE_PHASE_LENGTH_SECONDS = 60 * 60;

/**
 * The sample provider guarantees exactly one sample per minute, so a stage
 * that runs up to the last sample of a session is extended by this much to
 * give it a real, non-zero duration.
 */
export const TRAILING_STAGE_SECONDS = 60;

const MIN_SESSION_LENGTH_MS = MIN_SESSION_LENGTH_SECONDS * 1000;
const MAX_WAKE_PHASE_LENGTH_MS = MAX_WAKE_PHASE_LENGTH_SECONDS * 1000;
const TRAILING_STAGE_MS = TRAILING_STAGE_SECONDS * 1000;

/** Derives sleep sessions from an ordered list of activity samples. */
export function segment(samples: readonly SleepActivitySample[]): SleepSession[] {
  const result: SleepSession[] = [];

  let firstSleepIdx = -1;
  let lastSleepIdx = -1;
  let durationSinceLastSleep = 0;
  let previousSample: SleepActivitySample | undefined;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const isSleep = isSleepKind(sample.kind);

    if (isSleep) {
      if (firstSleepIdx === -1) firstSleepIdx = index;
      lastSleepIdx = index;
      durationSinceLastSleep = 0;
    } else if (firstSleepIdx !== -1) {
      const gap = sample.time - previousSample!.time;
      const hasActivity = sample.steps > 0;
      if (hasActivity || durationSinceLastSleep + gap > MAX_WAKE_PHASE_LENGTH_MS) {
        emit(result, samples, firstSleepIdx, lastSleepIdx);
        firstSleepIdx = -1;
        lastSleepIdx = -1;
      }
    }

    if (previousSample !== undefined && !isSleep) {
      durationSinceLastSleep += sample.time - previousSample.time;
      if (firstSleepIdx !== -1 && durationSinceLastSleep > MAX_WAKE_PHASE_LENGTH_MS) {
        emit(result, samples, firstSleepIdx, lastSleepIdx);
        firstSleepIdx = -1;
        lastSleepIdx = -1;
      }
    }

    previousSample = sample;
  }

  if (firstSleepIdx !== -1) {
    emit(result, samples, firstSleepIdx, lastSleepIdx);
  }

  return result;
}

/**
 * Builds a session from `samples[firstSleepIdx...lastSleepIdx]` (inclusive)
 * and appends it if it is long enough. Both indices always point at sleep
 * samples, so the session bounds are never degenerate.
 */
function emit(
  result: SleepSession[],
  samples: readonly SleepActivitySample[],
  firstSleepIdx: number,
  lastSleepIdx: number,
): void {
  const span = samples[lastSleepIdx]!.time + TRAILING_STAGE_MS - samples[firstSleepIdx]!.time;
  if (span <= MIN_SESSION_LENGTH_MS) return;

  const stages = buildStages(samples, firstSleepIdx, lastSleepIdx);
  if (stages.length > 0) result.push(makeSleepSession(stages));
}

/**
 * Groups `samples[firstIdx...lastIdx]` (inclusive) into runs of the same kind.
 * Non-sleep samples are grouped into `awake`.
 *
 * Upstream starts from `samples[firstIdx + 1]`, so the first sample's own kind
 * never becomes a stage: only the delta *into* a kind change is attributed.
 * That quirk is preserved.
 */
function buildStages(
  samples: readonly SleepActivitySample[],
  firstIdx: number,
  lastIdx: number,
): SleepStage[] {
  const stages: SleepStage[] = [];

  let stageStart = samples[firstIdx]!.time;
  let currentKind = toSleepKind(samples[firstIdx + 1]!);

  for (let index = firstIdx + 2; index <= lastIdx; index += 1) {
    const kind = toSleepKind(samples[index]!);
    if (kind !== currentKind) {
      const stageEnd = samples[index - 1]!.time;
      stages.push({ kind: currentKind, start: stageStart, end: stageEnd });
      currentKind = kind;
      stageStart = stageEnd;
    }
  }

  const sessionEnd = samples[lastIdx]!.time + TRAILING_STAGE_MS;
  stages.push({ kind: currentKind, start: stageStart, end: sessionEnd });

  return stages;
}

/** Upstream `toSleepKind`: any non-sleep sample becomes an awake stage. */
function toSleepKind(sample: SleepActivitySample): SleepStageKind {
  return isSleepKind(sample.kind) ? sample.kind : "awake";
}
