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
 * TypeScript port of Gadgetbridge's `StepAnalysis` segmentation and
 * activity-kind inference.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Semantics preserved from upstream:
 * - A minute is active when `steps > minStepsPerMinute` **or**
 *   (`intensity > minSessionIntensity` and `steps > 0`).
 * - A non-active run shorter than `maxIdlePhaseLengthSeconds` is buffered and
 *   re-absorbed (steps, distance, heart rate and intensity) when activity
 *   resumes; a run at or beyond the limit splits the session.
 * - A session must reach `minSessionLengthSeconds`; its length excludes the
 *   trailing idle phase.
 * - Every positive step in the day counts toward `totalDailySteps`, including
 *   samples inside recorded workouts. Workout samples are excluded from
 *   segmentation only.
 *
 * Deviations, documented in `index.ts`: samples are sorted by time before
 * processing (upstream assumes ordered input), and overlapping workout
 * intervals are treated as a union (upstream's `RangeMap` has a last-write
 * quirk at interval edges).
 */

import {
  DEFAULT_STEP_ANALYSIS_CONFIG,
  minSessionIntensityFor,
  resolveStepAnalysisConfig,
} from "./types";
import type {
  ActivityKindInput,
  MinuteSample,
  StepActivityKind,
  StepAnalysisConfig,
  StepSegmentation,
  StepSession,
  WorkoutInterval,
} from "./types";

/** Upstream hardcodes this walking threshold; tunable. */
export const WALKING_STEPS_THRESHOLD = 200;

/** Upstream hardcodes this exercise heart-rate threshold; tunable. */
export const EXERCISE_HEART_RATE_THRESHOLD = 90;

/** Upstream hardcodes this exercise intensity threshold; tunable. */
export const EXERCISE_INTENSITY_THRESHOLD = 15;

/**
 * Segments per-minute samples into activity sessions.
 *
 * `samples` need not be sorted; a stable copy sorted by time is processed.
 * `workoutIntervals` are `[start, end)` windows whose samples are excluded
 * from segmentation but still counted in `totalDailySteps`.
 */
export function segment(
  samples: readonly MinuteSample[],
  config?: Partial<StepAnalysisConfig>,
  workoutIntervals: readonly WorkoutInterval[] = [],
): StepSegmentation {
  const resolved = resolveStepAnalysisConfig(config);
  const minSessionIntensity = minSessionIntensityFor(resolved);

  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const segmentable: MinuteSample[] = [];
  let totalDailySteps = 0;
  for (const sample of sorted) {
    // Upstream counts workout steps in the filter and non-workout steps in the
    // main loop; the union is every positive step in the day.
    if (sample.steps > 0) totalDailySteps += sample.steps;
    if (!isInWorkout(sample.time, workoutIntervals)) segmentable.push(sample);
  }

  const sessions: StepSession[] = [];

  let sessionStart: number | null = null;
  let previous: MinuteSample | null = null;
  let activeSteps = 0;
  let activeDistanceCm = 0;
  let stepsBetweenActivePeriods = 0;
  let distanceBetweenActivePeriods = 0;
  let durationSinceLastActiveStep = 0;
  let activeIntensity = 0;
  let intensityBetweenActivePeriods = 0;
  let heartRateSum: number[] = [];
  let heartRateBetweenActivePeriods: number[] = [];

  for (const sample of segmentable) {
    if (sessionStart === null) {
      sessionStart = sample.time;
      activeSteps = Math.max(sample.steps, 0);
      const distance = distanceOf(sample);
      activeDistanceCm =
        distance >= 0 ? distance : activeSteps > 0 ? activeSteps * resolved.stepLengthCm : 0;
      activeIntensity = sample.intensity;
      heartRateSum = [];
      if (isValidHeartRate(sample.heartRate, resolved)) heartRateSum.push(sample.heartRate);
      durationSinceLastActiveStep = 0;
      stepsBetweenActivePeriods = 0;
      distanceBetweenActivePeriods = 0;
      heartRateBetweenActivePeriods = [];
      previous = null;
    }

    if (previous !== null) {
      const durationSinceLastSample = (sample.time - previous.time) / 1000;

      const active =
        sample.steps > resolved.minStepsPerMinute ||
        (sample.intensity > minSessionIntensity && sample.steps > 0);

      if (active) {
        activeSteps += sample.steps + stepsBetweenActivePeriods;
        const distance = distanceOf(sample);
        if (distance >= 0) {
          activeDistanceCm += distance + distanceBetweenActivePeriods;
        } else {
          activeDistanceCm += sample.steps * resolved.stepLengthCm + distanceBetweenActivePeriods;
        }
        activeIntensity += sample.intensity + intensityBetweenActivePeriods;
        if (isValidHeartRate(sample.heartRate, resolved)) heartRateSum.push(sample.heartRate);
        heartRateSum.push(...heartRateBetweenActivePeriods);
        heartRateBetweenActivePeriods = [];
        stepsBetweenActivePeriods = 0;
        distanceBetweenActivePeriods = 0;
        intensityBetweenActivePeriods = 0;
        durationSinceLastActiveStep = 0;
      } else {
        // Short break data to remember; it is added to the rest when activity resumes.
        if (sample.steps >= 0) stepsBetweenActivePeriods += sample.steps;
        const distance = distanceOf(sample);
        if (distance >= 0) {
          distanceBetweenActivePeriods += distance;
        } else if (sample.steps > 0) {
          distanceBetweenActivePeriods += sample.steps * resolved.stepLengthCm;
        }
        if (isValidHeartRate(sample.heartRate, resolved)) {
          heartRateBetweenActivePeriods.push(sample.heartRate);
        }
        durationSinceLastActiveStep += durationSinceLastSample;
        intensityBetweenActivePeriods += sample.intensity;
      }

      if (durationSinceLastActiveStep >= resolved.maxIdlePhaseLengthSeconds) {
        // Break too long: the session ends before the idle phase.
        const sessionLength = (sample.time - sessionStart) / 1000 - durationSinceLastActiveStep;
        if (sessionLength >= resolved.minSessionLengthSeconds) {
          sessions.push(
            buildSession(
              sessionStart,
              sample.time - durationSinceLastActiveStep * 1000,
              sessionLength,
              activeSteps,
              activeDistanceCm,
              heartRateSum,
              activeIntensity,
              false,
              resolved,
            ),
          );
        }
        sessionStart = null;
      }
    }

    previous = sample;
  }

  // Trailing activity: show the last portion even when no further activity is recorded yet.
  if (sessionStart !== null && previous !== null) {
    const sessionLength = (previous.time - sessionStart) / 1000 - durationSinceLastActiveStep;
    if (sessionLength >= resolved.minSessionLengthSeconds) {
      sessions.push(
        buildSession(
          sessionStart,
          previous.time,
          sessionLength,
          activeSteps,
          activeDistanceCm,
          heartRateSum,
          activeIntensity,
          true,
          resolved,
        ),
      );
    }
  }

  return { sessions, totalDailySteps };
}

/**
 * Upstream `detect_activity_kind`, in precedence order:
 * running (steps per minute), walking (step count), exercise (HR + intensity),
 * otherwise activity.
 */
export function detectActivityKind(
  session: ActivityKindInput,
  config?: Partial<StepAnalysisConfig>,
): StepActivityKind {
  const minStepsPerMinuteForRun =
    config?.minStepsPerMinuteForRun ?? DEFAULT_STEP_ANALYSIS_CONFIG.minStepsPerMinuteForRun;
  const minutes = Math.trunc(session.activeDurationSeconds / 60);
  const stepsPerMinute = minutes > 0 ? Math.trunc(session.steps / minutes) : 0;

  if (stepsPerMinute > minStepsPerMinuteForRun) return "running";
  if (session.steps > WALKING_STEPS_THRESHOLD) return "walking";
  if (
    session.heartRateAverage > EXERCISE_HEART_RATE_THRESHOLD &&
    session.intensity > EXERCISE_INTENSITY_THRESHOLD
  ) {
    return "exercise";
  }
  return "activity";
}

function buildSession(
  start: number,
  end: number,
  activeDurationSeconds: number,
  steps: number,
  activeDistanceCm: number,
  heartRateSum: readonly number[],
  intensity: number,
  ongoing: boolean,
  config: StepAnalysisConfig,
): StepSession {
  let heartRateTotal = 0;
  for (const value of heartRateSum) heartRateTotal += value;
  const heartRateAverage =
    heartRateSum.length > 0 ? Math.trunc(heartRateTotal / heartRateSum.length) : 0;

  return {
    start,
    end,
    activeDurationSeconds,
    steps,
    distanceMeters: activeDistanceCm * 0.01,
    heartRateAverage,
    intensity,
    kind: detectActivityKind({ activeDurationSeconds, steps, heartRateAverage, intensity }, config),
    ongoing,
  };
}

/** Upstream `getDistanceCm()` sentinel: negative/absent means unknown. */
function distanceOf(sample: MinuteSample): number {
  const distance = sample.distanceCm;
  return typeof distance === "number" && Number.isFinite(distance) ? distance : -1;
}

/** Upstream `HeartRateUtils.isValidHeartRateValue`: positive and within range. */
function isValidHeartRate(
  value: number | null | undefined,
  config: StepAnalysisConfig,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value >= config.minHeartRate &&
    value <= config.maxHeartRate
  );
}

/** A sample belongs to a workout when it falls in any `[start, end)` interval. */
function isInWorkout(time: number, intervals: readonly WorkoutInterval[]): boolean {
  for (const interval of intervals) {
    if (time >= interval.start && time < interval.end) return true;
  }
  return false;
}
