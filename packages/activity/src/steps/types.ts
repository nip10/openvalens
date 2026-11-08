/*  Copyright (C) 2020-2024 Petr Vaněk

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
 * TypeScript port of Gadgetbridge's `StepAnalysis` types and defaults.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Time convention: every timestamp is **epoch milliseconds** (a plain
 * `number`, UTC), matching the sleep and activity-history ports. Upstream
 * activity samples used epoch seconds; this module converts once at the
 * boundary and keeps all durations in seconds.
 *
 * Coupling removed from upstream:
 * - `ActivityUser` preferences → `StepAnalysisConfig` with the upstream
 *   defaults (`stepLengthCm` is 75 cm, upstream's derived default from a
 *   175 cm height).
 * - `GBApplication.getPrefs()` → config fields.
 * - `BaseActivitySummary` / `RangeMap` workouts → plain
 *   `WorkoutInterval[]` passed by the caller.
 * - `ActivitySession`, `ActivitySample`, `TrailingActivitySample` and the
 *   chart/DAO layer → plain input/output objects defined here.
 */

/** Pinned upstream revision this port was taken from. */
export const STEP_ANALYSIS_UPSTREAM_REVISION = "8976702fc3d00e6008c91fe994668cb4027f7bc2";

/** The activity kinds `detectActivityKind` can return, mirroring upstream `ActivityKind`. */
export type StepActivityKind = "running" | "walking" | "exercise" | "activity";

/**
 * One per-minute activity sample.
 *
 * `steps` and `distanceCm` use upstream's sentinel convention: a negative
 * value means "not measured". `intensity` is upstream's normalized 0..1
 * value. `heartRate` is optional; `null`, `undefined`, non-finite or
 * out-of-range values are ignored.
 */
export type MinuteSample = {
  /** Sample time, epoch milliseconds (UTC). */
  time: number;
  steps: number;
  /** Normalized intensity, 0..1. */
  intensity: number;
  heartRate?: number | null;
  /** Distance for this minute in centimetres; negative/absent means unknown. */
  distanceCm?: number | null;
};

/** A recorded workout interval, `[start, end)` in epoch milliseconds. */
export type WorkoutInterval = {
  start: number;
  end: number;
};

/**
 * Every tunable constant of the step analysis. Defaults are upstream's
 * `chart_list_*` preference defaults and `ActivityUser`/`HeartRateUtils`
 * defaults; treat them as tunable, not as fitted constants.
 */
export type StepAnalysisConfig = {
  /** Upstream `chart_list_min_session_length` (minutes) × 60. */
  minSessionLengthSeconds: number;
  /** Upstream `chart_list_max_idle_phase_length` (minutes) × 60. */
  maxIdlePhaseLengthSeconds: number;
  /** Upstream `chart_list_min_steps_per_minute`. */
  minStepsPerMinute: number;
  /**
   * Upstream `ActivityUser.getStepLengthCm()`. When the user preference is
   * unset, upstream derives it from the default height:
   * `int(175 cm * 0.43) = 75 cm`.
   */
  stepLengthCm: number;
  /** Upstream `chart_list_min_steps_per_minute_for_run`. */
  minStepsPerMinuteForRun: number;
  /** Upstream `HeartRateUtils` minimum valid value. */
  minHeartRate: number;
  /** Upstream `HeartRateUtils` maximum valid value. */
  maxHeartRate: number;
};

/** Upstream defaults, verbatim. */
export const DEFAULT_STEP_ANALYSIS_CONFIG: Readonly<StepAnalysisConfig> = Object.freeze({
  minSessionLengthSeconds: 60 * 5,
  maxIdlePhaseLengthSeconds: 60 * 5,
  minStepsPerMinute: 40,
  stepLengthCm: 75,
  minStepsPerMinuteForRun: 120,
  minHeartRate: 10,
  maxHeartRate: 250,
});

/**
 * Upstream derives the intensity gate from the step gate:
 * `clamp(minStepsPerMinute * 0.01, 0, 1)`. Keeping it derived means changing
 * `minStepsPerMinute` moves both gates together, as upstream does.
 */
export function minSessionIntensityFor(config: StepAnalysisConfig): number {
  return Math.max(0, Math.min(1, config.minStepsPerMinute * 0.01));
}

/** Merges overrides onto the upstream defaults. */
export function resolveStepAnalysisConfig(
  overrides?: Partial<StepAnalysisConfig>,
): StepAnalysisConfig {
  if (!overrides) return DEFAULT_STEP_ANALYSIS_CONFIG;
  return { ...DEFAULT_STEP_ANALYSIS_CONFIG, ...overrides };
}

/**
 * One inferred activity session. `start`/`end` are upstream's session bounds;
 * `activeDurationSeconds` is upstream's `session_length`, which excludes a
 * trailing idle phase even when `end` includes it.
 */
export type StepSession = {
  /** Session start, epoch milliseconds. */
  start: number;
  /** Session end, epoch milliseconds. */
  end: number;
  /** Upstream `session_length`: active seconds, excluding trailing idle. */
  activeDurationSeconds: number;
  /** Steps counted toward the session (buffered break steps included). */
  steps: number;
  /** Distance in metres; upstream keeps this as a float. */
  distanceMeters: number;
  /** Average of valid heart-rate samples, truncated to an integer. */
  heartRateAverage: number;
  /** Sum of per-minute intensity values (upstream's un-normalized sum). */
  intensity: number;
  kind: StepActivityKind;
  /** True for the last, still-open session (upstream `SESSION_ONGOING`). */
  ongoing: boolean;
};

/** `segment` result: inferred sessions plus the whole day's step count. */
export type StepSegmentation = {
  sessions: StepSession[];
  /** Every positive step in the input, including samples inside workouts. */
  totalDailySteps: number;
};

/** Aggregated totals across sessions. */
export type StepSummary = {
  sessionCount: number;
  /** Sum of `end - start` across sessions, in seconds. */
  durationSeconds: number;
  steps: number;
  /** Sum of session distances, truncated to whole metres as upstream does. */
  distanceMeters: number;
  /** Mean of session heart-rate averages, including zero-HR sessions. */
  heartRateAverage: number;
  /** Sum of session intensity values. */
  intensity: number;
  /** Whole-day steps, including recorded workouts. */
  totalDailySteps: number;
};

/** The fields `detectActivityKind` needs; a `StepSession` satisfies it. */
export type ActivityKindInput = Pick<
  StepSession,
  "activeDurationSeconds" | "steps" | "heartRateAverage" | "intensity"
>;
