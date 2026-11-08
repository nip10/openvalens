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
 * TypeScript port of Gadgetbridge's sleep-stage estimator types.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepMinute.kt`
 * (plus the data classes in `SleepStageEstimator.kt`).
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepMinute.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Time convention: every timestamp in this module is **epoch milliseconds**
 * (a plain `number`, UTC). Upstream used `java.time.Instant`; the estimator
 * only ever compares and buckets instants, so millis are lossless here and
 * keep the module free of runtime dependencies. Minute slots are derived as
 * `Math.floor(time / 60_000)`.
 */

/** Pinned upstream revision this port was taken from. */
export const SLEEP_ESTIMATOR_UPSTREAM_REVISION = "8976702fc3d00e6008c91fe994668cb4027f7bc2";

/**
 * What a watch that does not stage sleep said about one minute. `code` is
 * what upstream stores; keep the numeric values stable for persistence.
 */
export const SleepMinuteKind = {
  /** Heart rate and movement, left for the phone to classify. */
  RAW: 0,
  /** The watch was sure the wearer was awake. */
  AWAKE: 1,
  /** Not worn, or no signal. */
  UNMEASURABLE: 2,
} as const;

export type SleepMinuteKind = (typeof SleepMinuteKind)[keyof typeof SleepMinuteKind];

/** Upstream `SleepMinuteKind.fromCode`. */
export function sleepMinuteKindFromCode(code: number): SleepMinuteKind | null {
  switch (code) {
    case SleepMinuteKind.RAW:
      return SleepMinuteKind.RAW;
    case SleepMinuteKind.AWAKE:
      return SleepMinuteKind.AWAKE;
    case SleepMinuteKind.UNMEASURABLE:
      return SleepMinuteKind.UNMEASURABLE;
    default:
      return null;
  }
}

/** The estimator's input for one minute. Only movement and heart rate are used. */
export type SleepMinute = {
  /** Minute start, epoch milliseconds (UTC). */
  time: number;
  kind: SleepMinuteKind;
  /** Movement count for the minute; zero when still. Ignored unless `kind` is RAW. */
  movement?: number;
  /** Beats per minute, or `null` when the row carried none. */
  heartRate?: number | null;
};

/** A stage the estimator assigns to a minute. `unknown` is a not-worn gap inside the night. */
export type EstimatedStage = "awake" | "light" | "deep" | "rem" | "unknown";

/** `[start, end)` spent at `stage`, in epoch milliseconds. */
export type EstimatedStageSpan = {
  start: number;
  end: number;
  stage: EstimatedStage;
};

/** One estimated night. `onset` is sleep onset, not bed time. */
export type EstimatedSleepSession = {
  onset: number;
  end: number;
  /** True until 45 minutes of not sleeping have been seen after `end`. */
  inProgress: boolean;
  stages: EstimatedStageSpan[];
  sleepMinutes: number;
  awakeMinutes: number;
  unknownMinutes: number;
  /** The deep and REM score thresholds after the sanity loop. 0.6 when it never fired. */
  deepThreshold: number;
  remThreshold: number;
};

/**
 * The part of a stream one import may replace: every session inside
 * `[zoneStart, zoneEnd)`, a stretch that begins and ends in a long break, so
 * no sleep crosses its edges. `sessions` may be empty while the zone is not:
 * the zone is then known to hold no sleep any more.
 */
export type SettledEstimate = {
  zoneStart: number;
  zoneEnd: number;
  sessions: EstimatedSleepSession[];
};

/**
 * Every constant of the estimator. The defaults were fitted on three nights
 * of one wearer's Venu SQ; a caller can tighten or loosen them.
 */
export type SleepEstimatorConfig = {
  /** Activity assigned to a minute the watch itself called awake. */
  awakeActivity: number;
  /** Weighted activity at or above which a raw minute counts as awake. */
  sleepThreshold: number;
  /** A run of not sleeping this long splits candidate blocks and ends a night. */
  maxBreakMinutes: number;
  /** Sleep onset is the first sleep run this long; the end is the last one. */
  onsetRunMinutes: number;
  endRunMinutes: number;
  minWindowMinutes: number;
  minSleepMinutes: number;
  heartRateSmoothHalf: number;
  baselineHalf: number;
  deviationHalf: number;
  movementHalf: number;
  /** A wake run this long resets the post-wake light-sleep rule. */
  wakeRunMinutes: number;
  remLatencyMinutes: number;
  postWakeLightMinutes: number;
  deviationScale: number;
  variabilityWeight: number;
  deepMovementPenalty: number;
  remMovementPenalty: number;
  deepPriorStart: number;
  deepPriorSlope: number;
  remPriorStart: number;
  remPriorSlope: number;
  deepThreshold: number;
  remThreshold: number;
  minSegmentMinutes: number;
  bridgeMinutes: number;
  deepShareMin: number;
  deepShareMax: number;
  remShareMin: number;
  remShareMax: number;
  adaptStep: number;
  adaptMaxIterations: number;
};

/**
 * Upstream `SleepEstimatorConfig()` defaults, verbatim. These are fitted
 * constants: do not tune them here without a product decision.
 */
export const DEFAULT_SLEEP_ESTIMATOR_CONFIG: Readonly<SleepEstimatorConfig> = Object.freeze({
  awakeActivity: 10,
  sleepThreshold: 8,
  maxBreakMinutes: 45,
  onsetRunMinutes: 10,
  endRunMinutes: 10,
  minWindowMinutes: 180,
  minSleepMinutes: 150,
  heartRateSmoothHalf: 2,
  baselineHalf: 45,
  deviationHalf: 3,
  movementHalf: 2,
  wakeRunMinutes: 3,
  remLatencyMinutes: 60,
  postWakeLightMinutes: 10,
  deviationScale: 2,
  variabilityWeight: 0.5,
  deepMovementPenalty: 0.6,
  remMovementPenalty: 0.4,
  deepPriorStart: 0.5,
  deepPriorSlope: -1.0,
  remPriorStart: -0.6,
  remPriorSlope: 1.2,
  deepThreshold: 0.6,
  remThreshold: 0.6,
  minSegmentMinutes: 5,
  bridgeMinutes: 2,
  deepShareMin: 0.1,
  deepShareMax: 0.25,
  remShareMin: 0.15,
  remShareMax: 0.3,
  adaptStep: 0.1,
  adaptMaxIterations: 8,
});

/**
 * Upstream takes a whole `SleepEstimatorConfig`; this port accepts a partial
 * override so callers can change one fitted constant without repeating the
 * rest. Unknown keys are ignored by the spread merge.
 */
export function resolveSleepEstimatorConfig(
  overrides?: Partial<SleepEstimatorConfig>,
): SleepEstimatorConfig {
  if (!overrides) return DEFAULT_SLEEP_ESTIMATOR_CONFIG;
  return { ...DEFAULT_SLEEP_ESTIMATOR_CONFIG, ...overrides };
}
