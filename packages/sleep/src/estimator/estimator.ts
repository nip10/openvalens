/*  Copyright (C) 2026 Manuel Marcatili

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * TypeScript port of Gadgetbridge's `SleepStageEstimator`.
 *
 * Estimates sleep from per-minute movement and heart rate, for watches that
 * leave staging to the vendor's servers. Sleep/wake follows actigraphy
 * practice (Cole-Kripke weights, Webster rescoring); stages follow heart
 * rate against its own slow baseline, its variability, and time-of-night
 * priors. Pure and deterministic: the same minutes always give the same
 * sessions.
 *
 * This is a heuristic without ground truth. Read the stages as "when heart
 * rate was low and steady versus high and variable", not as a sleep lab.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepStageEstimator.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepStageEstimator.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Deliberate porting notes:
 * - Timestamps are epoch milliseconds (see `./types`).
 * - Kotlin `Float` becomes JavaScript `number` (float64). The algorithm is
 *   unchanged; only intermediate precision is higher. All fitted constants
 *   are preserved exactly.
 * - The public API accepts `Partial<SleepEstimatorConfig>` so one constant
 *   can be overridden without restating the rest.
 */

import { applyWebsterRescoring, runsOf, SleepLabels } from "./labels";
import type { SleepLabel } from "./labels";
import {
  DEFAULT_SLEEP_ESTIMATOR_CONFIG,
  resolveSleepEstimatorConfig,
  SleepMinuteKind,
} from "./types";
import type {
  EstimatedSleepSession,
  EstimatedStage,
  EstimatedStageSpan,
  SettledEstimate,
  SleepEstimatorConfig,
  SleepMinute,
} from "./types";

const MS_PER_MINUTE = 60_000;

/**
 * How far a minute's sleep/wake label can depend on its neighbours:
 * Cole-Kripke reads four minutes back and two forward, and the three
 * Webster passes chain on top of that, to 148 back and 89 forward.
 */
export const LABEL_REACH_MINUTES = 150;

/** A candidate night: window indices into the grid and how many minutes scored as sleep. */
type SleepBlock = {
  onset: number;
  end: number;
  sleepCount: number;
};

/** Grid indices `[start, end)`. */
type LabelSpan = {
  start: number;
  end: number;
};

type StagedWindow = {
  stages: EstimatedStage[];
  deepThreshold: number;
  remThreshold: number;
};

/**
 * The input on a one-minute grid: sorted, duplicates resolved (last wins),
 * missing minutes filled as not worn so a partial file behaves like a gap.
 */
class MinuteGrid {
  private constructor(
    private readonly startMinute: number,
    readonly kinds: SleepMinuteKind[],
    readonly movement: Float64Array,
    /** Beats per minute, or NaN when the minute carried none. */
    readonly heartRate: Float64Array,
  ) {}

  get size(): number {
    return this.kinds.length;
  }

  timeAt(index: number): number {
    return (this.startMinute + index) * MS_PER_MINUTE;
  }

  /** Movement for scoring: the watch's own awake verdict counts as strong movement. */
  activity(config: SleepEstimatorConfig): Float64Array {
    const activity = new Float64Array(this.size);
    for (let index = 0; index < this.size; index += 1) {
      const kind = this.kinds[index]!;
      activity[index] =
        kind === SleepMinuteKind.RAW
          ? this.movement[index]!
          : kind === SleepMinuteKind.AWAKE
            ? config.awakeActivity
            : 0;
    }
    return activity;
  }

  static of(minutes: readonly SleepMinute[]): MinuteGrid | null {
    if (minutes.length === 0) return null;
    const byMinute = new Map<number, SleepMinute>();
    const sorted = [...minutes].sort((a, b) => a.time - b.time);
    for (const minute of sorted) {
      byMinute.set(Math.floor(minute.time / MS_PER_MINUTE), minute);
    }
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const slot of byMinute.keys()) {
      if (slot < first) first = slot;
      if (slot > last) last = slot;
    }
    const size = last - first + 1;
    const kinds = Array.from({ length: size }, (): SleepMinuteKind => SleepMinuteKind.UNMEASURABLE);
    const movement = new Float64Array(size);
    const heartRate = new Float64Array(size).fill(Number.NaN);
    for (const [slot, minute] of byMinute) {
      const index = slot - first;
      kinds[index] = minute.kind;
      if (minute.kind === SleepMinuteKind.RAW) {
        const rawMovement = Math.max(minute.movement ?? 0, 0);
        movement[index] = Number.isFinite(rawMovement) ? rawMovement : 0;
        const bpm = minute.heartRate;
        if (bpm != null && Number.isFinite(bpm) && bpm > 0) heartRate[index] = bpm;
      }
    }
    return new MinuteGrid(first, kinds, movement, heartRate);
  }
}

/** Per-minute stage features over one window. Indices are window-local. */
class StageFeatures {
  private constructor(
    readonly deviation: Float64Array,
    readonly variability: Float64Array,
    readonly variabilityMedian: number,
    readonly movement: Float64Array,
    readonly sinceWake: Int32Array,
  ) {}

  static of(
    grid: MinuteGrid,
    labels: readonly SleepLabel[],
    onset: number,
    end: number,
    config: SleepEstimatorConfig,
  ): StageFeatures {
    const length = end - onset;
    const heartRate = new Float64Array(length);
    const sleeping = Array.from({ length }, () => false);
    for (let index = 0; index < length; index += 1) {
      heartRate[index] = grid.heartRate[onset + index]!;
      sleeping[index] = labels[onset + index] === SleepLabels.SLEEP;
    }

    const smoothed = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      smoothed[index] = medianOf(
        heartRate,
        index - config.heartRateSmoothHalf,
        index + config.heartRateSmoothHalf,
      );
    }
    // The baseline follows the night: heart rate keeps falling for an hour after onset.
    const deviation = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      const base = medianOf(
        smoothed,
        index - config.baselineHalf,
        index + config.baselineHalf,
        sleeping,
      );
      deviation[index] =
        Number.isNaN(smoothed[index]!) || Number.isNaN(base) ? 0 : smoothed[index]! - base;
    }

    const rawVariability = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      rawVariability[index] = standardDeviationOf(
        heartRate,
        index - config.deviationHalf,
        index + config.deviationHalf,
      );
    }
    const sleepingVariability = new Float64Array(length);
    let count = 0;
    for (let index = 0; index < length; index += 1) {
      if (sleeping[index] && !Number.isNaN(rawVariability[index]!)) {
        sleepingVariability[count] = rawVariability[index]!;
        count += 1;
      }
    }
    const variabilityMedian = count === 0 ? 1 : medianOf(sleepingVariability, 0, count - 1);
    const variability = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      variability[index] = Number.isNaN(rawVariability[index]!)
        ? variabilityMedian
        : rawVariability[index]!;
    }

    const activity = grid.activity(config);
    const movement = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      let sum = 0;
      for (let at = index - config.movementHalf; at <= index + config.movementHalf; at += 1) {
        if (at >= 0 && at < length) sum += activity[onset + at]!;
      }
      movement[index] = sum;
    }

    // Minutes since the last wake or gap run of at least wakeRunMinutes ended.
    const sinceWake = new Int32Array(length).fill(2_147_483_647);
    let runLength = 0;
    let lastWakeEnd = -1;
    for (let index = 0; index < length; index += 1) {
      if (sleeping[index]) {
        if (runLength >= config.wakeRunMinutes) lastWakeEnd = index;
        runLength = 0;
        if (lastWakeEnd >= 0) sinceWake[index] = index - lastWakeEnd;
      } else {
        runLength += 1;
      }
    }

    return new StageFeatures(deviation, variability, variabilityMedian, movement, sinceWake);
  }
}

const MIN_VARIABILITY_SAMPLES = 4;

/** Median of the finite values in `[from, to]`, optionally only where `mask` is true. NaN if none. */
function medianOf(
  values: Float64Array,
  from: number,
  to: number,
  mask?: readonly boolean[],
): number {
  const low = Math.max(from, 0);
  const high = Math.min(to, values.length - 1);
  if (high < low) return Number.NaN;
  const picked: number[] = [];
  for (let index = low; index <= high; index += 1) {
    const value = values[index]!;
    if (Number.isNaN(value)) continue;
    if (mask && !mask[index]) continue;
    picked.push(value);
  }
  if (picked.length === 0) return Number.NaN;
  picked.sort((a, b) => a - b);
  return picked.length % 2 === 1
    ? picked[(picked.length - 1) / 2]!
    : (picked[picked.length / 2 - 1]! + picked[picked.length / 2]!) / 2;
}

/** Population standard deviation over `[from, to]`, or NaN with fewer than four samples. */
function standardDeviationOf(values: Float64Array, from: number, to: number): number {
  const low = Math.max(from, 0);
  const high = Math.min(to, values.length - 1);
  let count = 0;
  let sum = 0;
  for (let index = low; index <= high; index += 1) {
    const value = values[index]!;
    if (Number.isNaN(value)) continue;
    count += 1;
    sum += value;
  }
  if (count < MIN_VARIABILITY_SAMPLES) return Number.NaN;
  const mean = sum / count;
  let squares = 0;
  for (let index = low; index <= high; index += 1) {
    const value = values[index]!;
    if (Number.isNaN(value)) continue;
    const delta = value - mean;
    squares += delta * delta;
  }
  return Math.sqrt(squares / count);
}

/** The session in `minutes` with the most sleep, the earliest on a tie, or null when none qualifies. */
export function estimate(
  minutes: readonly SleepMinute[],
  config?: Partial<SleepEstimatorConfig>,
): EstimatedSleepSession | null {
  const sessions = estimateAll(minutes, config);
  let best: EstimatedSleepSession | null = null;
  for (const session of sessions) {
    if (best === null || session.sleepMinutes > best.sleepMinutes) best = session;
  }
  return best;
}

/** Every session in `minutes`, in time order: each stretch between long breaks that holds real sleep. */
export function estimateAll(
  minutes: readonly SleepMinute[],
  config?: Partial<SleepEstimatorConfig>,
): EstimatedSleepSession[] {
  const resolved = resolveSleepEstimatorConfig(config);
  const grid = MinuteGrid.of(minutes);
  if (!grid) return [];
  const labels = scoreSleepWake(grid, resolved);
  return findBlocks(labels, resolved).map((block) => sessionOf(grid, labels, block, resolved));
}

/**
 * The sessions of `minutes` that a whole-stream estimate would also find, with the zone
 * they settle. `minutes` is a stretch of a longer stored stream; `gapBefore` and `gapAfter`
 * say how many minute slots are missing between it and the nearest stored minute on each
 * side, null when there is none within a break's length. A missing stretch of
 * `maxBreakMinutes` or more is a break whatever lies beyond it, so the stretch is padded
 * with that much gap and its edge settles. Where the stream continues without a gap, the
 * labels near the edge could still change with the minutes beyond it, so
 * `LABEL_REACH_MINUTES` at that edge are left unsettled. Null when no break lies in the
 * settled part.
 */
export function estimateSettled(
  minutes: readonly SleepMinute[],
  gapBefore: number | null,
  gapAfter: number | null,
  config?: Partial<SleepEstimatorConfig>,
): SettledEstimate | null {
  if (minutes.length === 0) return null;
  const resolved = resolveSleepEstimatorConfig(config);
  const breakMinutes = resolved.maxBreakMinutes;
  const padBefore = Math.min(gapBefore ?? breakMinutes, breakMinutes);
  const padAfter = Math.min(gapAfter ?? breakMinutes, breakMinutes);
  // The grid fills what lies between its first and last minute as gap, so one sentinel pads a side.
  const padded = [...minutes];
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  for (const minute of minutes) {
    if (minute.time < minTime) minTime = minute.time;
    if (minute.time > maxTime) maxTime = minute.time;
  }
  if (padBefore > 0) {
    padded.push({
      time: minTime - MS_PER_MINUTE * padBefore,
      kind: SleepMinuteKind.UNMEASURABLE,
    });
  }
  if (padAfter > 0) {
    padded.push({
      time: maxTime + MS_PER_MINUTE * padAfter,
      kind: SleepMinuteKind.UNMEASURABLE,
    });
  }
  const grid = MinuteGrid.of(padded);
  if (!grid) return null;
  const labels = scoreSleepWake(grid, resolved);

  const settledFrom = gapBefore === 0 ? LABEL_REACH_MINUTES : 0;
  const settledTo = gapAfter === 0 ? grid.size - LABEL_REACH_MINUTES : grid.size;
  const breaks = findBreaks(labels, resolved);
  const settledBreaks = breaks.filter((brk) => {
    // At least a whole break's worth of it lies in the settled part.
    return Math.max(brk.start, settledFrom) + breakMinutes <= Math.min(brk.end, settledTo);
  });
  if (settledBreaks.length === 0) return null;
  const firstBreak = settledBreaks[0]!;
  const lastBreak = settledBreaks[settledBreaks.length - 1]!;
  const sessions = findBlocks(labels, resolved, breaks)
    .filter((block) => block.onset >= firstBreak.end && block.end <= lastBreak.start)
    .map((block) => sessionOf(grid, labels, block, resolved));
  return {
    zoneStart: grid.timeAt(Math.max(firstBreak.start, settledFrom)),
    zoneEnd: grid.timeAt(Math.min(lastBreak.end, settledTo)),
    sessions,
  };
}

function sessionOf(
  grid: MinuteGrid,
  labels: readonly SleepLabel[],
  block: SleepBlock,
  config: SleepEstimatorConfig,
): EstimatedSleepSession {
  const staged = classifyStages(grid, labels, block.onset, block.end, config);
  const stages = staged.stages;
  const spans: EstimatedStageSpan[] = [];
  let runStart = 0;
  for (let index = 1; index <= stages.length; index += 1) {
    if (index === stages.length || stages[index] !== stages[runStart]) {
      spans.push({
        start: grid.timeAt(block.onset + runStart),
        end: grid.timeAt(block.onset + index),
        stage: stages[runStart]!,
      });
      runStart = index;
    }
  }
  let sleepMinutes = 0;
  let awakeMinutes = 0;
  let unknownMinutes = 0;
  for (const stage of stages) {
    if (stage === "light" || stage === "deep" || stage === "rem") sleepMinutes += 1;
    else if (stage === "awake") awakeMinutes += 1;
    else unknownMinutes += 1;
  }
  return {
    onset: grid.timeAt(block.onset),
    end: grid.timeAt(block.end),
    inProgress: grid.size - block.end < config.maxBreakMinutes,
    stages: spans,
    sleepMinutes,
    awakeMinutes,
    unknownMinutes,
    deepThreshold: staged.deepThreshold,
    remThreshold: staged.remThreshold,
  };
}

/** Sleep (S), wake (W) or gap (G) per minute, after Webster rescoring. */
function scoreSleepWake(grid: MinuteGrid, config: SleepEstimatorConfig): SleepLabel[] {
  const activity = grid.activity(config);
  const labels = Array.from({ length: grid.size }, (): SleepLabel => SleepLabels.GAP);
  for (let index = 0; index < grid.size; index += 1) {
    const kind = grid.kinds[index]!;
    if (kind === SleepMinuteKind.UNMEASURABLE) {
      labels[index] = SleepLabels.GAP;
    } else if (kind === SleepMinuteKind.AWAKE) {
      labels[index] = SleepLabels.WAKE;
    } else {
      let weighted = 0;
      for (let offset = 0; offset < COLE_KRIPKE_WEIGHTS.length; offset += 1) {
        const at = index + offset - COLE_KRIPKE_CENTER;
        if (at >= 0 && at < grid.size) {
          weighted += COLE_KRIPKE_WEIGHTS[offset]! * activity[at]!;
        }
      }
      labels[index] = weighted < config.sleepThreshold ? SleepLabels.SLEEP : SleepLabels.WAKE;
    }
  }
  applyWebsterRescoring(labels);
  return labels;
}

/** The breaks: runs of not sleeping (wake or gap mixed) at least maxBreak long, as `[start, end)`. */
function findBreaks(labels: readonly SleepLabel[], config: SleepEstimatorConfig): LabelSpan[] {
  const breaks: LabelSpan[] = [];
  let index = 0;
  while (index < labels.length) {
    if (labels[index] === SleepLabels.SLEEP) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < labels.length && labels[index] !== SleepLabels.SLEEP) index += 1;
    if (index - start >= config.maxBreakMinutes) breaks.push({ start, end: index });
  }
  return breaks;
}

/** Candidate sleep blocks: spans between long breaks that hold a real night. */
function findBlocks(
  labels: readonly SleepLabel[],
  config: SleepEstimatorConfig,
  breaks: readonly LabelSpan[] = findBreaks(labels, config),
): SleepBlock[] {
  const blocks: SleepBlock[] = [];
  let spanStart = 0;
  for (const brk of breaks) {
    const block = blockOf(labels, spanStart, brk.start, config);
    if (block) blocks.push(block);
    spanStart = brk.end;
  }
  const block = blockOf(labels, spanStart, labels.length, config);
  if (block) blocks.push(block);
  return blocks;
}

function blockOf(
  labels: readonly SleepLabel[],
  from: number,
  to: number,
  config: SleepEstimatorConfig,
): SleepBlock | null {
  if (to <= from) return null;
  const runs = runsOf(labels, from, to).filter((run) => run.label === SleepLabels.SLEEP);
  const onsetRun = runs.find((run) => run.length >= config.onsetRunMinutes);
  if (!onsetRun) return null;
  let endRun: (typeof runs)[number] | undefined;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]!;
    if (run.length >= config.endRunMinutes) {
      endRun = run;
      break;
    }
  }
  if (!endRun) return null;
  const onset = onsetRun.start;
  const end = endRun.start + endRun.length;
  if (end - onset < config.minWindowMinutes) return null;
  let sleepCount = 0;
  for (let index = onset; index < end; index += 1) {
    if (labels[index] === SleepLabels.SLEEP) sleepCount += 1;
  }
  if (sleepCount < config.minSleepMinutes) return null;
  return { onset, end, sleepCount };
}

/** Stages for the window `[onset, end)`, with the thresholds the sanity loop settled on. */
function classifyStages(
  grid: MinuteGrid,
  labels: readonly SleepLabel[],
  onset: number,
  end: number,
  config: SleepEstimatorConfig,
): StagedWindow {
  const length = end - onset;
  const features = StageFeatures.of(grid, labels, onset, end, config);
  let deepThreshold = config.deepThreshold;
  let remThreshold = config.remThreshold;
  let stages = decide(features, labels, onset, length, deepThreshold, remThreshold, config);
  for (let iteration = 0; iteration < config.adaptMaxIterations; iteration += 1) {
    let sleeping = 0;
    let deep = 0;
    let rem = 0;
    for (const stage of stages) {
      if (stage === "light" || stage === "deep" || stage === "rem") sleeping += 1;
      if (stage === "deep") deep += 1;
      if (stage === "rem") rem += 1;
    }
    if (sleeping === 0) break;
    const deepShare = deep / sleeping;
    const remShare = rem / sleeping;
    let moved = false;
    if (deepShare < config.deepShareMin) {
      deepThreshold -= config.adaptStep;
      moved = true;
    } else if (deepShare > config.deepShareMax) {
      deepThreshold += config.adaptStep;
      moved = true;
    }
    if (remShare < config.remShareMin) {
      remThreshold -= config.adaptStep;
      moved = true;
    } else if (remShare > config.remShareMax) {
      remThreshold += config.adaptStep;
      moved = true;
    }
    if (!moved) break;
    stages = decide(features, labels, onset, length, deepThreshold, remThreshold, config);
  }
  return { stages, deepThreshold, remThreshold };
}

function decide(
  features: StageFeatures,
  labels: readonly SleepLabel[],
  onset: number,
  length: number,
  deepThreshold: number,
  remThreshold: number,
  config: SleepEstimatorConfig,
): EstimatedStage[] {
  const stages = Array.from({ length }, (): EstimatedStage => "light");
  const variabilityScale = Math.max(features.variabilityMedian, 1);
  for (let index = 0; index < length; index += 1) {
    const label = labels[onset + index];
    if (label === SleepLabels.GAP) {
      stages[index] = "unknown";
      continue;
    }
    if (label === SleepLabels.WAKE) {
      stages[index] = "awake";
      continue;
    }
    const position = index / length;
    const deviation = features.deviation[index]! / config.deviationScale;
    const variability =
      (features.variability[index]! - features.variabilityMedian) / variabilityScale;
    const moving = features.movement[index]! > 0;
    let deep =
      -deviation -
      config.variabilityWeight * variability +
      (config.deepPriorStart + config.deepPriorSlope * position);
    if (moving) deep -= config.deepMovementPenalty;
    let rem =
      deviation +
      config.variabilityWeight * variability +
      (config.remPriorStart + config.remPriorSlope * position);
    if (moving) rem -= config.remMovementPenalty;
    if (index < config.remLatencyMinutes) rem = Number.NEGATIVE_INFINITY;
    if (features.sinceWake[index]! < config.postWakeLightMinutes) {
      deep = Number.NEGATIVE_INFINITY;
    }
    stages[index] =
      deep > deepThreshold && deep >= rem ? "deep" : rem > remThreshold ? "rem" : "light";
  }
  smooth(stages, config);
  return stages;
}

/** Short deep/REM runs become light; a light sliver between two runs of one stage joins them. */
function smooth(stages: EstimatedStage[], config: SleepEstimatorConfig): void {
  for (const run of stageRuns(stages)) {
    if ((run.stage === "deep" || run.stage === "rem") && run.length < config.minSegmentMinutes) {
      for (let index = run.start; index < run.start + run.length; index += 1) {
        stages[index] = "light";
      }
    }
  }
  const runs = stageRuns(stages);
  for (let position = 0; position < runs.length; position += 1) {
    const run = runs[position]!;
    if (run.stage !== "light" || run.length > config.bridgeMinutes) continue;
    const before = runs[position - 1];
    const after = runs[position + 1];
    if (!before || !after) continue;
    if (before.stage === after.stage && (before.stage === "deep" || before.stage === "rem")) {
      for (let index = run.start; index < run.start + run.length; index += 1) {
        stages[index] = before.stage;
      }
    }
  }
}

type StageRun = {
  stage: EstimatedStage;
  start: number;
  length: number;
};

function stageRuns(stages: readonly EstimatedStage[]): StageRun[] {
  const runs: StageRun[] = [];
  let start = 0;
  for (let index = 1; index <= stages.length; index += 1) {
    if (index === stages.length || stages[index] !== stages[start]) {
      runs.push({ stage: stages[start]!, start, length: index - start });
      start = index;
    }
  }
  return runs;
}

/** Cole-Kripke one-minute weights for t-4..t+2, scaled so the centre is 1. */
const COLE_KRIPKE_WEIGHTS: readonly number[] = [0.29, 0.42, 0.23, 0.31, 1.0, 0.36, 0.25];
const COLE_KRIPKE_CENTER = 4;

// Re-exported so consumers of the estimator subpath get the defaults too.
export { DEFAULT_SLEEP_ESTIMATOR_CONFIG, resolveSleepEstimatorConfig, SleepMinuteKind };
